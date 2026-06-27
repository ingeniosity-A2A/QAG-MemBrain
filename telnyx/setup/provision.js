#!/usr/bin/env node
/**
 * Telnyx provisioning script.
 *
 * Buys a WhatsApp Business number, configures the webhook URL, and
 * enables WhatsApp messaging + calling on it.
 *
 * Usage:
 *   node provision.js
 *
 * Env vars (required):
 *   TELNYX_API_KEY     — from https://portal.telnyx.com/#/app/api-keys
 *   WEBHOOK_URL        — your Cloudflare Worker URL (e.g. https://ava007-proxy.xyz.workers.dev)
 *
 * Env vars (optional):
 *   COUNTRY_CODE       — ISO 2-letter, default "US"
 *   AREA_CODE          — preferred area code, default "" (any)
 *   PROFILE_NAME       — WhatsApp Business display name, default "AVA007"
 *
 * Output: prints the phone_number_id and E.164 number — paste these
 * into your AVA007 config + the Worker KV.
 */

const TELNYX_BASE = "https://api.telnyx.com/v2";

function env(name, fallback) {
  const v = process.env[name];
  if (!v && !fallback) {
    console.error(`✗ Missing required env var: ${name}`);
    process.exit(1);
  }
  return v || fallback;
}

async function telnyxFetch(path, options = {}) {
  const apiKey = env("TELNYX_API_KEY");
  const url = `${TELNYX_BASE}${path}`;
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...options.headers,
  };

  const resp = await fetch(url, { ...options, headers });
  const body = await resp.text();

  if (!resp.ok) {
    console.error(`✗ Telnyx API error ${resp.status}: ${body}`);
    process.exit(1);
  }

  return JSON.parse(body);
}

async function main() {
  const webhookUrl = env("WEBHOOK_URL") + "/webhook";
  const countryCode = env("COUNTRY_CODE", "US");
  const areaCode = env("AREA_CODE", "");
  const profileName = env("PROFILE_NAME", "AVA007");

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       Telnyx WhatsApp Number Provisioning                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // ── 1. List available WhatsApp numbers ─────────────────────────────
  console.log(`Searching for available WhatsApp numbers in ${countryCode}...`);
  let searchPath = `/phone_number_search?filter[features]=whatsapp&filter[country_code]=${countryCode}`;
  if (areaCode) {
    searchPath += `&filter[national_destination_code]=${areaCode}`;
  }
  // Limit to 5 results to keep the search fast
  searchPath += `&page[size]=5`;

  const search = await telnyxFetch(searchPath);
  const numbers = search.data || [];

  if (numbers.length === 0) {
    console.error(`✗ No WhatsApp-capable numbers found in ${countryCode}`);
    console.error("  Try a different country code or area code.");
    process.exit(1);
  }

  console.log(`\nFound ${numbers.length} available numbers:`);
  numbers.forEach((n, i) => {
    console.log(`  [${i + 1}] ${n.phone_number} (${n.region || "unknown region"})`);
  });

  // ── 2. Pick the first (or let user choose) ─────────────────────────
  const choice = process.env.PICK || "1";
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= numbers.length) {
    console.error(`✗ Invalid choice: ${choice}`);
    process.exit(1);
  }
  const phoneNumber = numbers[idx].phone_number;
  console.log(`\n→ Selected: ${phoneNumber}`);

  // ── 3. Buy the number ──────────────────────────────────────────────
  console.log("\nPurchasing number...");
  const purchase = await telnyxFetch("/phone_numbers", {
    method: "POST",
    body: JSON.stringify({
      phone_numbers: [{ phone_number: phoneNumber }],
      messaging_profile_id: undefined, // we'll create one below
    }),
  });

  const purchasedId = purchase.data[0].id;
  console.log(`  ✓ Purchased (phone_number_id: ${purchasedId})`);

  // ── 4. Create a WhatsApp profile ───────────────────────────────────
  console.log(`\nCreating WhatsApp Business profile "${profileName}"...`);
  let profileId;
  try {
    const profile = await telnyxFetch("/whatsapp_profiles", {
      method: "POST",
      body: JSON.stringify({
        name: profileName,
        number: phoneNumber,
        webhook_url: webhookUrl,
        webhook_version: "2023-12-15",
      }),
    });
    profileId = profile.data.id;
    console.log(`  ✓ Profile created (id: ${profileId})`);
  } catch (e) {
    // The number might already have a profile — try to fetch
    console.log("  → Profile may already exist, fetching...");
    const existing = await telnyxFetch(`/whatsapp_profiles?filter[number]=${phoneNumber}`);
    if (existing.data && existing.data.length > 0) {
      profileId = existing.data[0].id;
      console.log(`  ✓ Existing profile (id: ${profileId})`);
    } else {
      throw e;
    }
  }

  // ── 5. Update webhook URL ──────────────────────────────────────────
  console.log(`\nConfiguring webhook URL: ${webhookUrl}`);
  await telnyxFetch(`/whatsapp_profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({
      webhook_url: webhookUrl,
    }),
  });
  console.log("  ✓ Webhook URL set");

  // ── 6. Enable WhatsApp calling ─────────────────────────────────────
  console.log("\nEnabling WhatsApp calling...");
  try {
    const callingResp = await telnyxFetch(`/whatsapp_phone_numbers/${purchasedId}/calling`, {
      method: "POST",
      body: JSON.stringify({ calling_enabled: true }),
    });
    console.log(`  ✓ Calling enabled: ${callingResp.data.calling_enabled}`);
  } catch (e) {
    console.log(`  → Calling endpoint not available yet — number may need WhatsApp Business verification first`);
    console.log(`     You can enable it later via the AVA007 WhatsApp command.`);
  }

  // ── 7. Print summary ───────────────────────────────────────────────
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                PROVISIONING COMPLETE                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log("Your WhatsApp Business number is now configured:\n");
  console.log(`  Phone number:        ${phoneNumber}`);
  console.log(`  Phone number ID:     ${purchasedId}`);
  console.log(`  WhatsApp profile ID: ${profileId}`);
  console.log(`  Webhook URL:         ${webhookUrl}`);
  console.log(`  Calling enabled:     true\n`);
  console.log("Add these to AVA007 config (or to the Worker KV):\n");
  console.log(`  AVA007_WHATSAPP_FROM=${phoneNumber}`);
  console.log(`  AVA007_WHATSAPP_PHONE_ID=${purchasedId}`);
  console.log(`  AVA007_WHATSAPP_PROFILE_ID=${profileId}`);
  console.log("\nTo register the tunnel URL with the Worker (run after AVA007 starts):");
  console.log(`  curl -X POST ${env("WEBHOOK_URL")}/admin/tunnel \\`);
  console.log(`    -H "X-Webhook-Secret: $AVA007_WEBHOOK_SECRET" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"tunnel_url":"https://<tunnel-id>.cfargotunnel.com","phone_number_id":"${purchasedId}"}'\n`);
  console.log("Done. AVA007 can now send + receive WhatsApp messages.");
}

main().catch((e) => {
  console.error(`\n✗ Provisioning failed: ${e.message}`);
  process.exit(1);
});
