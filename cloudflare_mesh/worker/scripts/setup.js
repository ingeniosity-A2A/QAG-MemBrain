#!/usr/bin/env node
/**
 * One-shot setup script for AVA007 Worker.
 *
 * Run this AFTER you've:
 *   1. `npm install` in this directory
 *   2. `npx wrangler login` (opens browser, OAuth with Cloudflare)
 *
 * This script does the rest:
 *   1. Creates the three KV namespaces
 *   2. Updates wrangler.toml with the namespace IDs
 *   3. Prompts for and sets the three secrets (TELNYX_API_KEY, WEBHOOK_SECRET, TELNYX_WEBHOOK_SECRET)
 *   4. Generates a device token and writes it to KV (DEVICE_TOKENS)
 *   5. Deploys the Worker
 *   6. Prints the Worker URL + device token for AVA007 to use
 *
 * Usage:
 *   node scripts/setup.js
 *
 * Env vars (or interactive prompts):
 *   TELNYX_API_KEY         — from https://portal.telnyx.com/#/app/api-keys
 *   WEBHOOK_SECRET         — generated if not provided (openssl rand -hex 32)
 *   TELNYX_WEBHOOK_SECRET  — from Telnyx WhatsApp settings page
 *   DEVICE_ID              — defaults to "ava007-s26-ultra"
 */

const { execSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]: ` : ": ";
    rl.question(question + suffix, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function exec(cmd, options = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], ...options });
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       AVA007 Cloudflare Worker — Setup Wizard             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // ── Pre-flight checks ────────────────────────────────────────────
  console.log("Pre-flight checks...");
  try {
    exec("npx wrangler whoami");
    console.log("  ✓ wrangler authenticated");
  } catch (e) {
    console.error("  ✗ wrangler not authenticated. Run: npx wrangler login");
    process.exit(1);
  }

  // ── 1. Gather secrets ────────────────────────────────────────────
  console.log("\n── Gathering secrets ──────────────────────────────────────");

  const telnyxApiKey = process.env.TELNYX_API_KEY || await prompt("Enter your Telnyx API key");
  if (!telnyxApiKey) {
    console.error("✗ Telnyx API key is required");
    process.exit(1);
  }

  const webhookSecret = process.env.WEBHOOK_SECRET ||
    crypto.randomBytes(32).toString("hex");
  console.log(`  ✓ WEBHOOK_SECRET: ${webhookSecret.slice(0, 8)}...${webhookSecret.slice(-4)} (generated)`);

  const telnyxWebhookSecret = process.env.TELNYX_WEBHOOK_SECRET ||
    await prompt("Enter Telnyx webhook signing secret (from WhatsApp settings page)");

  const deviceId = process.env.DEVICE_ID || await prompt("Enter device ID", "ava007-s26-ultra");

  // ── 2. Create KV namespaces ──────────────────────────────────────
  console.log("\n── Creating KV namespaces ─────────────────────────────────");
  const namespaces = ["DEVICE_TOKENS", "DEVICE_TUNNELS", "RATE_LIMITS"];
  const ids = {};
  for (const name of namespaces) {
    try {
      const output = exec(`npx wrangler kv:namespace create ${name}`);
      const match = output.match(/id\s*=\s*"([a-f0-9]+)"/i);
      if (!match) throw new Error(`Could not parse ID from output: ${output}`);
      ids[name] = match[1];
      console.log(`  ✓ ${name}: ${ids[name]}`);
    } catch (e) {
      console.error(`  ✗ Failed to create ${name}: ${e.message}`);
      process.exit(1);
    }
  }

  // Update wrangler.toml
  const tomlPath = path.join(__dirname, "..", "wrangler.toml");
  let toml = fs.readFileSync(tomlPath, "utf-8");
  for (const [name, id] of Object.entries(ids)) {
    const regex = new RegExp(
      `(\\[\\[kv_namespaces\\]\\]\\s*binding\\s*=\\s*"${name}"\\s*id\\s*=\\s*)""`,
      "g",
    );
    toml = toml.replace(regex, `$1"${id}"`);
  }
  fs.writeFileSync(tomlPath, toml);
  console.log("  ✓ wrangler.toml updated");

  // ── 3. Set secrets ───────────────────────────────────────────────
  console.log("\n── Setting Worker secrets ─────────────────────────────────");
  for (const [name, value] of [
    ["TELNYX_API_KEY", telnyxApiKey],
    ["WEBHOOK_SECRET", webhookSecret],
    ["TELNYX_WEBHOOK_SECRET", telnyxWebhookSecret],
  ]) {
    const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
      input: value + "\n",
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      console.error(`  ✗ Failed to set ${name}: ${result.stderr}`);
      process.exit(1);
    }
    console.log(`  ✓ ${name} set`);
  }

  // ── 4. Generate device token + write to KV ───────────────────────
  console.log("\n── Generating device token ───────────────────────────────");
  const deviceToken = crypto.randomBytes(32).toString("hex");

  // We need to deploy first so the Worker is up, then use the Worker's
  // KV binding. Or we can write to KV directly via wrangler kv.
  const kvKey = `token:${deviceToken}`;
  const kvValue = JSON.stringify({ device_id: deviceId, created_at: new Date().toISOString() });
  exec(
    `npx wrangler kv:key put --binding=DEVICE_TOKENS "${kvKey}" '${kvValue.replace(/"/g, '\\"')}'`,
    { stdio: "pipe" },
  );
  console.log(`  ✓ Device token written to KV (device_id=${deviceId})`);

  // ── 5. Deploy the Worker ─────────────────────────────────────────
  console.log("\n── Deploying Worker ───────────────────────────────────────");
  try {
    const output = exec("npx wrangler deploy");
    console.log("  ✓ Deployed");
    // Extract the deployed URL from output
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.workers\.dev/i);
    const workerUrl = urlMatch ? urlMatch[0] : "https://<your-worker>.workers.dev";
    console.log(`  ✓ Worker URL: ${workerUrl}`);

    // ── 6. Print AVA007 configuration ───────────────────────────────
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                    SETUP COMPLETE                          ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");
    console.log("Add these to your AVA007 device config:\n");
    console.log(`  TELNYX_WORKER_URL=${workerUrl}`);
    console.log(`  AVA007_DEVICE_TOKEN=${deviceToken}`);
    console.log(`  AVA007_WEBHOOK_SECRET=${webhookSecret}`);
    console.log(`  AVA007_DEVICE_ID=${deviceId}`);
    console.log("\nOr set as env vars in Termux:");
    console.log(`  export TELNYX_API_KEY="(leave blank — Worker holds the real key)"`);
    console.log(`  export AVA007_DEVICE_TOKEN="${deviceToken}"`);
    console.log(`  export AVA007_WEBHOOK_SECRET="${webhookSecret}"`);
    console.log(`  # The Worker URL goes in mobile_runtime/src/lib.rs:`);
    console.log(`  #   CloudflareConfig { worker_url: "${workerUrl}".into(), ... }`);
  } catch (e) {
    console.error(`  ✗ Deploy failed: ${e.message}`);
    process.exit(1);
  }

  rl.close();
}

main().catch((e) => {
  console.error(`\n✗ Setup failed: ${e.message}`);
  process.exit(1);
});
