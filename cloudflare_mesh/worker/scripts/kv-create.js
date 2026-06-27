#!/usr/bin/env node
/**
 * KV namespace creation script.
 *
 * Creates the three KV namespaces the Worker needs:
 *   DEVICE_TOKENS  — set of valid device tokens (for auth)
 *   DEVICE_TUNNELS — phone_number_id → tunnel URL mapping
 *   RATE_LIMITS    — per-device rate limit counters
 *
 * Updates wrangler.toml with the returned namespace IDs.
 *
 * Usage:
 *   node scripts/kv-create.js
 *
 * Requires: wrangler installed + `wrangler login` already done.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NAMESPACES = ["DEVICE_TOKENS", "DEVICE_TUNNELS", "RATE_LIMITS"];

function runWrangler(cmd) {
  try {
    const stdout = execSync(`npx wrangler ${cmd}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return stdout;
  } catch (e) {
    console.error(`wrangler command failed: ${e.message}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    process.exit(1);
  }
}

function parseNamespaceId(output) {
  // Output looks like:
  // ⛅️ wrangler
  // [[kv_namespaces]]
  // binding = "DEVICE_TOKENS"
  // id = "abc123def456..."
  const match = output.match(/id\s*=\s*"([a-f0-9]+)"/i);
  if (!match) {
    console.error("Could not parse namespace ID from wrangler output:");
    console.error(output);
    process.exit(1);
  }
  return match[1];
}

function updateWranglerToml(ids) {
  const tomlPath = path.join(__dirname, "..", "wrangler.toml");
  let toml = fs.readFileSync(tomlPath, "utf-8");

  for (const [name, id] of Object.entries(ids)) {
    // Find the kv_namespaces block with this binding and update its id
    const regex = new RegExp(
      `\\[\\[kv_namespaces\\]\\]\\s*binding\\s*=\\s*"${name}"\\s*id\\s*=\\s*""`,
      "g",
    );
    toml = toml.replace(regex, `[[kv_namespaces]]\nbinding = "${name}"\nid = "${id}"`);
  }

  fs.writeFileSync(tomlPath, toml);
  console.log("✓ Updated wrangler.toml with namespace IDs");
}

function main() {
  console.log("Creating KV namespaces...\n");

  const ids = {};
  for (const name of NAMESPACES) {
    console.log(`Creating ${name}...`);
    const output = runWrangler(`kv:namespace create ${name}`);
    const id = parseNamespaceId(output);
    ids[name] = id;
    console.log(`  → ${id}`);
  }

  console.log("\nUpdating wrangler.toml...");
  updateWranglerToml(ids);

  console.log("\n✅ KV namespaces created and wrangler.toml updated.");
  console.log("\nNext steps:");
  console.log("  1. npm run secret:put TELNYX_API_KEY");
  console.log("  2. npm run secret:put WEBHOOK_SECRET");
  console.log("  3. npm run secret:put TELNYX_WEBHOOK_SECRET");
  console.log("  4. npm run deploy");
}

main();
