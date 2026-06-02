# QAG_MemBrain — Consumption API

Surface packages and external agents interact with QAG_MemBrain through a
versioned REST + WebSocket API. All requests are authenticated via Ed25519 DID signatures.

**Base URL**
- Production: `https://membrain.ava-007.com/v1`
- Local: `http://localhost:8080/v1`

---

## Authentication

Every request must include a `Signature` header computed over the canonicalized
request body (or query string for GET requests):

```
Signature: did:ava:node123:Ed25519:<base64-encoded-signature>
```

The server verifies the signature against the DID document stored in the JSONL ledger.
SDKs handle signing automatically — see the SDK section below.

---

## Endpoints

### POST /memory
Write a new atomic JSONL memory.

**Request**
```json
{
  "type": "event",
  "source": "nfc_tap",
  "title": "Asset tag handshake",
  "content": "Tap from asset tag 0x7F3A at dock station 3",
  "metadata": {
    "confidence": 0.98,
    "importance": "high",
    "tags": ["nfc", "dock", "handshake"]
  }
}
```

**Response 200**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1717200000000,
  "vertex_hash": "0x9f2a3b4c..."
}
```

**Notes**
- `id` is a UUID generated server-side.
- `timestamp` is the canonical ingestion time (Unix ms). Do not send your own.
- `vertex_hash` is the SHA-256 of the signed JSONL line, used for DAG parent references.
- `importance` values: `low` | `medium` | `high` | `critical`
- `confidence` is a float 0.0–1.0 computed by the ingestion engine.

---

### GET /recall
Reconstruct state at a temporal coordinate.

**Query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `t` | Unix ms | Temporal coordinate to reconstruct at |
| `memory_id` | UUID | Optional — scope reconstruction to a memory thread |
| `fields` | comma list | Optional — return only specified state fields |

**Request**
```
GET /recall?t=1717200000000&memory_id=550e8400-...
```

**Response 200**
```json
{
  "state": {
    "attention_focus": 0.87,
    "current_context": "dock_station_3",
    "active_protocol": "A2A",
    "routing_mode": "executive"
  },
  "fidelity": 0.99,
  "reconstruction_time_ms": 12,
  "timeline_hash": "0xabc123..."
}
```

**Notes**
- `fidelity` is how completely the state could be reconstructed (1.0 = perfect replay).
- Low fidelity indicates DAG gaps — usually means offline atoms haven't synced yet.

---

### POST /branch
Create a counterfactual branch from a decision point.
Used by the cortex learning loop to evaluate alternative routing decisions.

**Request**
```json
{
  "memory_id": "550e8400-...",
  "branch_point": 1717199500000,
  "mutations": [
    {
      "property": "routing_choice",
      "from": "executive",
      "to": "reflex",
      "duration": 500,
      "ease": "power2.out"
    }
  ]
}
```

**Response 200**
```json
{
  "branch_id": "branch_001",
  "timeline_hash": "0xdef456...",
  "diverges_at": 1717199500000
}
```

**Notes**
- Branches are non-destructive. The main timeline is unaffected.
- The cortex uses branches to simulate alternative escalation decisions before
  writing new routing policies to the audit log.

---

### GET /audit
Retrieve the immutable audit log for a session or memory thread.

**Query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `session_id` | string | Session scope |
| `memory_id` | UUID | Memory thread scope |
| `brain_tier` | string | Filter by `reflex` | `executive` | `cortex` |
| `limit` | int | Max records (default 100, max 1000) |
| `after` | Unix ms | Pagination cursor |

**Request**
```
GET /audit?session_id=abc123&limit=50
```

**Response 200**
```json
{
  "entries": [
    {
      "id": "audit_001",
      "timestamp": 1717200000000,
      "brain_tier": "executive",
      "decision": "routing",
      "inputs": { "type": "nfc_tap", "confidence": 0.98 },
      "outputs": { "action": "A2A_handshake", "latency_ms": 42 },
      "reasoning": "confidence 0.98 ≥ 0.85 threshold; type in known pattern set",
      "model_used": "mellum2-moe",
      "vertex_hash": "0x9f2a3b4c..."
    }
  ],
  "next_cursor": 1717200100000
}
```

---

### POST /tashi/sync
Trigger a Tashi gossip sync for a specific node.
Used by surfaces to flush their offline queue when connectivity returns.

**Request**
```json
{
  "node_did": "did:ava:surface-node-01",
  "queue_depth": 47
}
```

**Response 200**
```json
{
  "synced": 47,
  "conflicts": 0,
  "new_vertices": 12
}
```

---

### WS /timeline
Subscribe to live timeline updates for a memory thread.

**Connection**
```
WS /timeline?memory_id=550e8400-...&Signature=did:ava:...
```

**Messages (server → client)**
```json
{ "event": "tween_update", "time": 1717200001000, "state": { ... } }
{ "event": "vertex_appended", "vertex_hash": "0x...", "source": "tashi_gossip" }
{ "event": "branch_resolved", "branch_id": "branch_001", "outcome": "adopted" }
```

**Notes**
- Subscribe once per memory thread. Multiple surfaces can subscribe to the same thread.
- `vertex_appended` fires when Tashi gossip delivers a new atom from a remote node.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Malformed request — invalid JSONL schema or missing required fields |
| 401 | Missing or invalid DID signature |
| 404 | Memory ID or timeline not found |
| 409 | Branch conflict — parent hash mismatch, replay integrity violation |
| 429 | Rate limit exceeded |
| 500 | Internal error — automatically logged to audit |

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| Write (`POST /memory`) | 100 req/s per DID |
| Read (`GET /recall`, `GET /audit`) | 1000 req/s per DID |
| WebSocket connections | 10 concurrent per DID |

---

## SDKs

### TypeScript
```bash
npm install @ava-007/membrain-sdk
```

```typescript
import { MemBrainClient } from '@ava-007/membrain-sdk';

const client = new MemBrainClient({
  nodeDid: 'did:ava:my-surface',
  privateKey: process.env.MEMBRAIN_PRIVATE_KEY,
  baseUrl: 'https://membrain.ava-007.com/v1'
});

// Write a memory
const memory = await client.writeMemory({
  type: 'user_action',
  source: 'ava-surface',
  content: 'Customer tapped Book Now',
  metadata: { importance: 'medium', confidence: 1.0 }
});

// Recall state at that moment
const state = await client.recall(memory.timestamp);

// Subscribe to live updates
const ws = client.subscribeTimeline(memory.id);
ws.on('tween_update', (update) => render(update.state));
```

### Python
```bash
pip install ava-membrain
```

```python
from ava_membrain import MemBrainClient

client = MemBrainClient(
    node_did="did:ava:my-agent",
    private_key=os.environ["MEMBRAIN_PRIVATE_KEY"]
)

memory = client.write_memory(
    type="agent_decision",
    source="cortex",
    content="Routed NFC event to executive tier",
    metadata={"importance": "high", "confidence": 0.94}
)

state = client.recall(t=memory["timestamp"])
```

---

## Versioning

This API follows semantic versioning. The current stable version is `v1`.

Breaking changes (removed fields, changed semantics) increment the major version to `/v2`.
Additive changes (new optional fields, new endpoints) do not require a version bump.
Deprecation notices are added to affected endpoint documentation before removal.
