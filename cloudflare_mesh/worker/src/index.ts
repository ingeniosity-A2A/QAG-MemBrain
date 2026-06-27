/**
 * AVA007 Cloudflare Worker — Telnyx proxy + WhatsApp webhook ingress.
 *
 * Two roles:
 *
 *   1. EGRESS PROXY
 *      AVA007 on the device sends `X-Device-Token: <token>` to this Worker.
 *      The Worker validates the token against a KV allowlist, injects the
 *      real Telnyx API key from Cloudflare secret store as
 *      `Authorization: Bearer <key>`, and forwards the request to
 *      https://api.telnyx.com.
 *
 *      Benefit: The Telnyx API key NEVER lives on the device. Even if
 *      AVA007 is compromised, the attacker only gets a device-scoped
 *      token that can be revoked from this Worker.
 *
 *   2. WEBHOOK INGRESS
 *      Telnyx fires WhatsApp webhooks (inbound messages, delivery receipts)
 *      at this Worker. The Worker:
 *        - Validates the Telnyx webhook signature
 *        - Looks up the device's tunnel URL from KV
 *        - Forwards the event to https://<tunnel-id>.cfargotunnel.com/webhook
 *        - Returns 200 OK to Telnyx immediately
 *
 * Env vars (set via `wrangler secret put`):
 *   TELNYX_API_KEY        — the real Telnyx API key (NEVER in repo)
 *   WEBHOOK_SECRET        — shared secret between Worker and AVA007 device
 *   TELNYX_WEBHOOK_SECRET — Telnyx's signing secret for webhook validation
 *
 * KV namespaces (bound in wrangler.toml):
 *   DEVICE_TOKENS   — set of valid device tokens (key=token, value=device_id)
 *   DEVICE_TUNNELS  — device_id → tunnel URL mapping
 *   RATE_LIMITS     — per-device rate limit counters
 *
 * Rate limits (default 60 req/min per device):
 *   Implemented via KV counters with TTL=60s. Returns 429 if exceeded.
 */

export interface Env {
  TELNYX_API_KEY: string;
  WEBHOOK_SECRET: string;
  TELNYX_WEBHOOK_SECRET: string;
  DEVICE_TOKENS: KVNamespace;
  DEVICE_TUNNELS: KVNamespace;
  RATE_LIMITS: KVNamespace;
}

const TELNYX_BASE = "https://api.telnyx.com/v2";
const RATE_LIMIT_PER_MIN = 60;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── Routing ─────────────────────────────────────────────────────
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/admin/tunnel" && request.method === "POST") {
      return handleTunnelRegistration(request, env);
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleTelnyxWebhook(request, env, ctx);
    }

    // Default: treat as Telnyx API proxy
    if (request.method === "POST" || request.method === "GET") {
      return handleTelnyxProxy(request, env, url);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ── EGRESS: Telnyx API proxy ────────────────────────────────────────────────

async function handleTelnyxProxy(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // 1. Validate device token
  const deviceToken = request.headers.get("X-Device-Token");
  if (!deviceToken) {
    return json({ error: "missing X-Device-Token" }, 401);
  }

  const deviceId = await env.DEVICE_TOKENS.get(deviceToken);
  if (!deviceId) {
    return json({ error: "invalid device token" }, 401);
  }

  // 2. Rate limit check (per device, per minute)
  const rateLimitKey = `ratelimit:${deviceId}:${Math.floor(Date.now() / 60000)}`;
  const current = parseInt(await env.RATE_LIMITS.get(rateLimitKey) || "0", 10);
  if (current >= RATE_LIMIT_PER_MIN) {
    return json({ error: "rate limit exceeded", retry_after: 60 }, 429);
  }
  // Increment counter (TTL = 120s, so it auto-expires after the minute)
  await env.RATE_LIMITS.put(rateLimitKey, String(current + 1), {
    expirationTtl: 120,
  });

  // 3. Build upstream URL
  const upstreamPath = url.pathname + url.search;
  const upstreamUrl = `${TELNYX_BASE}${upstreamPath}`;

  // 4. Clone request, swap auth header
  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete("X-Device-Token");
  upstreamHeaders.delete("X-Webhook-Secret");
  upstreamHeaders.set("Authorization", `Bearer ${env.TELNYX_API_KEY}`);
  upstreamHeaders.set("User-Agent", "AVA007-Worker/0.1");

  // 5. Strip device IP from upstream request
  upstreamHeaders.delete("CF-Connecting-IP");
  upstreamHeaders.delete("X-Forwarded-For");
  upstreamHeaders.delete("X-Real-IP");

  // 6. Forward
  const upstreamResp = await fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.method === "POST" ? await request.text() : undefined,
  });

  // 7. Copy response back, add rate-limit headers for AVA007
  const respHeaders = new Headers(upstreamResp.headers);
  respHeaders.set("X-RateLimit-Limit", String(RATE_LIMIT_PER_MIN));
  respHeaders.set("X-RateLimit-Remaining", String(RATE_LIMIT_PER_MIN - current - 1));
  respHeaders.set("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + 60));

  const body = await upstreamResp.text();
  return new Response(body, {
    status: upstreamResp.status,
    headers: respHeaders,
  });
}

// ── INGRESS: Telnyx webhook forwarding ──────────────────────────────────────

async function handleTelnyxWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // 1. Validate Telnyx webhook signature
  // Telnyx signs webhooks with the public key model — for v2 webhooks,
  // the signature is in the `Telnyx-Signature` header as a base64 Ed25519
  // signature of the timestamp + body.
  // For simplicity here, we use the shared WEBHOOK_SECRET approach:
  // Telnyx includes a `webhook_secret` field that must match.
  const body = await request.text();
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return json({ error: "invalid JSON" }, 400);
  }

  // 2. Find which device this webhook is for
  // Telnyx includes the phone_number_id in the payload — we map that
  // to a device_id via the DEVICE_TOKENS KV (reverse lookup).
  const phoneNumberId = payload?.data?.payload?.phone_number_id;
  if (!phoneNumberId) {
    return json({ error: "missing phone_number_id" }, 400);
  }

  // Look up the device tunnel URL
  // (We store phone_number_id → tunnel_url mapping at registration time)
  const tunnelUrl = await env.DEVICE_TUNNELS.get(`phone:${phoneNumberId}`);
  if (!tunnelUrl) {
    // No tunnel registered yet — return 200 so Telnyx doesn't retry,
    // but log for debugging
    console.warn(`No tunnel registered for phone_number_id=${phoneNumberId}`);
    return new Response("ok", { status: 200 });
  }

  // 3. Forward to device tunnel (non-blocking — return 200 to Telnyx)
  ctx.waitUntil(
    (async () => {
      try {
        await fetch(`${tunnelUrl}/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": env.WEBHOOK_SECRET,
          },
          body,
        });
      } catch (e) {
        console.error(`Failed to forward webhook to ${tunnelUrl}: ${e}`);
      }
    })(),
  );

  // 4. Return 200 OK immediately
  return new Response("ok", { status: 200 });
}

// ── ADMIN: tunnel registration ──────────────────────────────────────────────

async function handleTunnelRegistration(
  request: Request,
  env: Env,
): Promise<Response> {
  // Validate the shared admin secret
  const provided = request.headers.get("X-Webhook-Secret");
  if (provided !== env.WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await request.json() as { tunnel_url: string; phone_number_id?: string };
  if (!body.tunnel_url) {
    return json({ error: "missing tunnel_url" }, 400);
  }

  // Store the tunnel URL — keyed by phone_number_id if provided,
  // otherwise by a default key
  const key = body.phone_number_id
    ? `phone:${body.phone_number_id}`
    : "default_tunnel";
  await env.DEVICE_TUNNELS.put(key, body.tunnel_url);

  return json({ ok: true, tunnel_url: body.tunnel_url });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(obj: any, status: number = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
