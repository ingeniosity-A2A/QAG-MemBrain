// Pages Function: /api/chat — Ava007 lens proxy (backend for the chat dock).
//
// Governance (docs/FORGED_FILE_STANDARD.md §6/§9):
// - The model behind this endpoint is a vendored Hugging Face asset used by a
//   Capability — it is NOT a Forged File and never enters F0→F3 (§4).
// - Without HUGGINGFACE_TOKEN the endpoint is DEV-LOCKED: visible, inert,
//   reason reported (503) — never silently dead (§9).
// - Three-color rule applies to presentation only; this proxy is transport.
//
// Env: HUGGINGFACE_TOKEN (optional; set in Pages → ai-browser → Settings →
// Variables and Secrets). Model is the curated Salience-27B-R5 vendor asset.
export async function onRequestPost(context) {
  const { request, env } = context;
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  const deny = (reason) => json({ error: "dev_locked", reason }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", reason: "invalid JSON body" }, 400);
  }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return json({ error: "bad_request", reason: "messages[] required" }, 400);
  }
  for (const m of messages) {
    if (!m || typeof m !== "object" || typeof m.content !== "string" || !m.content.trim()) {
      return json({ error: "bad_request", reason: "each message needs non-empty content" }, 400);
    }
  }
  const clipped = messages.slice(-12).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content.slice(0, 8000),
  }));

  const token = env.HUGGINGFACE_TOKEN;
  if (!token) {
    return deny(
      "lens backend not configured (HUGGINGFACE_TOKEN missing) — chat is DEV-locked, visible + inert"
    );
  }

  try {
    const upstream = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: env.AVA007_CHAT_MODEL || "meta-llama/Llama-3.1-8B-Instruct",
          messages: [
            {
              role: "system",
              content:
                "You are Ava007, the intelligence behind the Ingeniosity agent browser. " +
                "Answer concisely; when the user's prompt starts with [LENS or [CURATE " +
                "you are reasoning over governed Forged File vault context.",
            },
            ...clipped,
          ],
          max_tokens: 512,
          stream: false,
        }),
      }
    );
    if (!upstream.ok) {
      const text = await upstream.text();
      return json(
        { error: "upstream_error", reason: "inference failed (" + upstream.status + "): " + text.slice(0, 200) },
        502
      );
    }
    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return json({ error: "upstream_error", reason: "empty completion" }, 502);
    return json({ reply });
  } catch (err) {
    return json({ error: "upstream_error", reason: String(err && err.message ? err.message : err) }, 502);
  }
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
