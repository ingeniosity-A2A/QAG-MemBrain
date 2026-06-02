# Consumption API – QAG_MemBrain

Surface packages (UI, runtime, external agents) interact with QAG_MemBrain through a clean REST + WebSocket API. All requests must be authenticated using DID signatures.

## Base URL
Production: `https://membrain.ava-007.com/v1`  
Local development: `http://localhost:8080/v1`

## Authentication
Every request must include a `Signature` header:
```
Signature: did:ava:node123:Ed25519:base64encodedSignature
```
The signature is computed over the canonicalized request body (or query string) using the node’s private key. The server verifies against the DID document stored in JSONL.

## Endpoints

### Write a new memory
```
POST /memory
Content-Type: application/json

{
  "type": "event",
  "source": "nfc_handshake",
  "content": "Tap from asset tag 0x7F3A",
  "metadata": {
    "confidence": 1.0,
    "importance": "high"
  }
}
```
Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1717200000000,
  "vertex_hash": "0x9f2a3b4c..."
}
```

### Reconstruct state (recall)
```
GET /recall?t=1717200000000&amp;memory_id=550e8400-...
```
Response:
```json
{
  "state": {
    "attention_focus": 0.87,
    "current_room": "assembly_knowledge",
    "active_protocol": "A2A"
  },
  "fidelity": 0.99,
  "reconstruction_time_ms": 12
}
```

### Branch from a decision point
```
POST /branch
Content-Type: application/json

{
  "memory_id": "550e8400-...",
  "branch_point": 1717199500000,
  "mutations": [
    {
      "property": "routing_choice",
      "from": "mesh",
      "to": "direct_ip",
      "duration": 500,
      "ease": "power2.out"
    }
  ]
}
```
Response: `{ "branch_id": "branch_001", "timeline_hash": "0x..." }`

### Subscribe to live timeline updates (WebSocket)
```
WS /timeline?memory_id=550e8400-...
```
Messages are JSON objects:
```json
{"event": "tween_update", "time": 1717200001000, "state": {...}}
{"event": "collapse", "superposition_id": "sp_01", "selected": "option_b"}
```

### Retrieve audit log
```
GET /audit?session_id=abc123&amp;limit=100
```
Response:
```json
{
  "entries": [
    {
      "timestamp": 1717200000000,
      "decision": "routing",
      "inputs": {...},
      "outputs": {...},
      "reasoning": "easing probability favored direct_ip (0.72)"
    }
  ]
}
```

## Error Handling
Standard HTTP status codes:
- `200` – Success
- `400` – Malformed request (e.g., invalid JSONL)
- `401` – Missing or invalid signature
- `404` – Memory/timeline not found
- `409` – Branch conflict (parent hash mismatch)
- `500` – Internal error (logged to audit)

## Rate Limits
- Write: 100 requests/second per DID
- Read: 1000 requests/second per DID

## SDKs
Official SDKs simplify authentication and serialization:
- TypeScript: `npm install @ava-007/membrain-sdk`
- Python: `pip install ava-membrain`

Example (TypeScript):
```typescript
import { MemBrainClient } from '@ava-007/membrain-sdk';

const client = new MemBrainClient({ 
  nodeDid: 'did:ava:my-surface',
  privateKey: process.env.PRIVATE_KEY
});

const memory = await client.writeMemory({
  type: 'user_action',
  content: 'Clicked book button'
});

const state = await client.recall(memory.timestamp);
```

## Versioning
The API follows semantic versioning. Breaking changes increment the major version (e.g., `/v2`). The current stable version is `v1`.
