# AVA007 — Cloudflare Mesh + Telnyx WhatsApp Deployment

This guide walks you through deploying the full WhatsApp messaging + calling
stack for AVA007. After completion, your device can:

- Send WhatsApp text/media/template messages via voice or text command
- Enable/disable WhatsApp calling on your Telnyx number
- Receive inbound WhatsApp messages as Receipts in the Context Ocean
- All egress goes through a Cloudflare Worker (API key never on device)
- All inbound webhooks arrive via Cloudflare Tunnel (no inbound ports)

## Architecture

```
   AVA007 device (S26 Ultra)
       │
       │ 1. POST https://ava007-proxy.<you>.workers.dev/v2/whatsapp_messages
       │    Header: X-Device-Token: <device_token>
       │    Body: {"from":"+1555...","to":"+1555...","text":"hello"}
       │
       ▼
   ┌─────────────────────────────────────────────┐
   │  Cloudflare Worker (TypeScript)             │
   │  • Validates device token against KV        │
   │  • Rate-limits per device (60/min)          │
   │  • Injects real Telnyx API key from secret  │
   │  • Strips device IP                         │
   │  • Forwards to https://api.telnyx.com       │
   └─────────────────────────────────────────────┘
       │
       ▼
   Telnyx API → WhatsApp Business → recipient's phone


   Recipient replies ↓
   Telnyx fires webhook at the Worker's /webhook endpoint
       │
       ▼
   ┌─────────────────────────────────────────────┐
   │  Cloudflare Worker                          │
   │  • Looks up device tunnel URL from KV       │
   │  • Forwards webhook payload to tunnel       │
   │  • Returns 200 OK to Telnyx immediately     │
   └─────────────────────────────────────────────┘
       │
       ▼
   Cloudflare Tunnel (cloudflared subprocess on device)
       │
       ▼
   AVA007 webhook server (localhost:8787)
       │
       ▼
   WebhookEvent → Receipt → Context Ocean
```

## Prerequisites

1. **Telnyx account** — https://portal.telnyx.com (sign up, ~5 min)
   - Generate an API key at: Portal → API Keys → Create API Key
   - You'll need WhatsApp Business verification (Telnyx walks you through
     this — usually takes 24-48h for the first number)

2. **Cloudflare account** — https://dash.cloudflare.com/sign-up (free tier works)
   - Install wrangler CLI: `npm install -g wrangler`
   - Authenticate: `wrangler login`

3. **Node.js 18+** on the machine you're deploying from (your laptop, not the phone)

## Quick Deploy (one command)

```bash
# From the repo root:
./deploy.sh
```

This runs the full setup: Worker deploy + secret config + KV creation +
Telnyx number provisioning. You'll be prompted for your Telnyx API key
if it's not in your env.

## Manual Deploy (step-by-step)

### Step 1: Deploy the Cloudflare Worker

```bash
cd cloudflare_mesh/worker

# Install deps
npm install

# Authenticate wrangler (one-time)
npx wrangler login

# Create KV namespaces + update wrangler.toml
node scripts/kv-create.js

# Set secrets (you'll be prompted for each value)
npx wrangler secret put TELNYX_API_KEY
#   → paste your Telnyx API key

npx wrangler secret put WEBHOOK_SECRET
#   → generate one: openssl rand -hex 32

npx wrangler secret put TELNYX_WEBHOOK_SECRET
#   → from Telnyx portal → WhatsApp → Settings → Webhook signing secret

# Deploy
npx wrangler deploy
```

The Worker is now live at `https://ava007-telnyx-proxy.<your-subdomain>.workers.dev`.

### Step 2: Register your AVA007 device

Generate a device token and store it in the Worker's KV:

```bash
# Generate a random token
DEVICE_TOKEN=$(openssl rand -hex 32)
echo "Your device token: $DEVICE_TOKEN"

# Store in KV (key=token:xxx, value=device metadata)
npx wrangler kv:key put --binding=DEVICE_TOKENS \
  "token:$DEVICE_TOKEN" \
  '{"device_id":"ava007-s26-ultra","created_at":"2026-06-27"}'
```

### Step 3: Provision a Telnyx WhatsApp number

```bash
cd telnyx/setup

# Set required env vars
export TELNYX_API_KEY="your_telnyx_key"
export WEBHOOK_URL="https://ava007-telnyx-proxy.<your-subdomain>.workers.dev"

# Optional: customize
export COUNTRY_CODE="US"        # ISO 2-letter
export AREA_CODE=""              # preferred area code, empty = any
export PROFILE_NAME="AVA007"    # WhatsApp Business display name

# Run the provisioning script
node provision.js
```

The script will:
1. Search for available WhatsApp-capable numbers
2. Buy one (you'll see the price before confirmation)
3. Create a WhatsApp Business profile
4. Configure the webhook URL on the number
5. Enable WhatsApp calling
6. Print the phone_number_id you'll need for AVA007 config

### Step 4: Configure AVA007 on the device

On your S26 Ultra in Termux:

```bash
# Set env vars (add to ~/.bashrc for persistence)
export AVA007_WORKER_URL="https://ava007-telnyx-proxy.<your-subdomain>.workers.dev"
export AVA007_DEVICE_TOKEN="<the token you generated in Step 2>"
export AVA007_WEBHOOK_SECRET="<the WEBHOOK_SECRET you set on the Worker>"
export AVA007_WHATSAPP_FROM="<the E.164 number Telnyx provisioned>"
export AVA007_WHATSAPP_PHONE_ID="<phone_number_id from Step 3>"

# Build + run AVA007
cd ~/QAG-MemBrain
cargo run --release -p mobile_runtime
```

When AVA007 starts, the `cloudflare_mesh` crate will:
1. Start the local webhook server on `localhost:8787`
2. Spawn `cloudflared tunnel --url http://localhost:8787`
3. Register the tunnel URL with the Worker (so webhooks get forwarded)

### Step 5: Test the integration

Say any of these to AVA007:

```
"send WhatsApp message to +15551234567 saying hello from AVA007"
"enable WhatsApp calling on phone ph_xxx"
"disable WhatsApp calling on phone ph_xxx"
"what's the status of my WhatsApp number ph_xxx"
```

Inbound messages from WhatsApp users will appear as Receipts in the
Context Ocean with `origin=USER`, `kind=Perception`.

## Cost Estimate

| Service | Free Tier | Paid |
|---------|-----------|------|
| Cloudflare Workers | 100k req/day | $5/mo for 10M req/month |
| Cloudflare KV | 1k writes/day, 100k reads/day | $5/mo for unlimited |
| Cloudflare Tunnel | Free | Free |
| Telnyx WhatsApp | $0.005/message sent, $0.0035/message received | Volume discounts |
| Telnyx phone number | ~$1-3/month per number | — |

Typical AVA007 usage: ~$5-10/month for moderate WhatsApp traffic.

## Security Notes

- **Telnyx API key NEVER lives on the device.** It's stored as a
  Cloudflare Worker secret (encrypted at rest, only decrypted in Worker
  memory during request handling).

- **Device token is revocable.** If your phone is lost/stolen, run:
  ```bash
  npx wrangler kv:key delete --binding=DEVICE_TOKENS "token:<stolen_token>"
  ```
  Then generate a new token for the replacement device.

- **Webhook signature validation.** The Worker validates the
  `WEBHOOK_SECRET` header on every request from the device. Telnyx's
  own webhook signature is validated against `TELNYX_WEBHOOK_SECRET`.

- **Rate limiting.** Each device token is capped at 60 API calls/min
  by the Worker. Prevents runaway code from burning your Telnyx bill.

- **Audit trail.** Every WhatsApp send/enable/disable produces a
  Receipt in the Context Ocean. Query the `knox_audit_log` view to
  see all telephony actions (all marked `knox_safe=TRUE` because
  they're cloud API calls, not device-side).

## Troubleshooting

### Worker deploy fails with "account_id required"
Open `wrangler.toml` and paste your account_id (from `wrangler whoami`).

### `wrangler kv:key put` fails with "namespace not found"
Make sure the KV namespace IDs are pasted into `wrangler.toml` after
running `node scripts/kv-create.js`.

### Telnyx provisioning fails with "WhatsApp not available"
You need WhatsApp Business verification on your Telnyx account first.
This is a one-time setup that Telnyx walks you through in the portal
(usually 24-48h). Until then, no numbers will show up as WhatsApp-capable.

### Inbound webhooks don't reach the device
1. Verify the tunnel is running: `cloudflared tunnel info`
2. Verify the tunnel URL is registered with the Worker:
   ```bash
   npx wrangler kv:key list --binding=DEVICE_TUNNELS
   ```
3. Check Worker logs: `npx wrangler tail`

### `cloudflared` not installed on the device
Install in Termux:
```bash
pkg install cloudflared
# Or download the ARM64 binary directly:
# https://github.com/cloudflare/cloudflared/releases/latest
```

## Files

| Path | Role |
|------|------|
| `cloudflare_mesh/worker/src/index.ts` | Worker source code |
| `cloudflare_mesh/worker/wrangler.toml` | Cloudflare config |
| `cloudflare_mesh/worker/scripts/setup.js` | One-shot Worker setup |
| `cloudflare_mesh/worker/scripts/kv-create.js` | KV namespace creation |
| `telnyx/setup/provision.js` | Telnyx number provisioning |
| `deploy.sh` | End-to-end deploy script |
| `cloudflare_mesh/src/lib.rs` | Rust client (uses Worker URL) |
| `telnyx/src/lib.rs` | Rust Telnyx client (proxies through Worker) |
