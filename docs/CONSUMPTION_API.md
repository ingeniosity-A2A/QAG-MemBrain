# Consumption API - QAG_MemBrain

Surface packages (UI, runtime, external agents) interact with QAG_MemBrain through a clean REST plus WebSocket API. All requests must be authenticated using DID signatures.

## Base URL
Production: https://membrain.ava-007.com/v1
Local development: http://localhost:8080/v1

## Authentication
Every request must include a Signature header:

Signature: did:ava:node123:Ed25519:base64encodedSignature

The signature is computed over the canonicalized request body (or query string) using the node private key. The server verifies against the DID document stored in JSONL.

## Endpoints

### Write a new memory
POST /memory
Content-Type: application/json

```json
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
GET /recall?t=1717200000000&memory_id=550e8400-...

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
POST /branch
Content-Type: application/json

```json
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

Response:

```json
{
  "branch_id": "branch_001",
  "timeline_hash": "0x..."
}
```

### Subscribe to live timeline updates (WebSocket)
WS /timeline?memory_id=550e8400-...

Messages:

```json
{"event": "tween_update", "time": 1717200001000, "state": {}}
{"event": "collapse", "superposition_id": "sp_01", "selected": "option_b"}
```

### Retrieve audit log
GET /audit?session_id=abc123&limit=100

Response:

```json
{
  "entries": [
    {
      "timestamp": 1717200000000,
      "decision": "routing",
      "inputs": {},
      "outputs": {},
      "reasoning": "easing probability favored direct_ip (0.72)"
    }
  ]
}
```

## REV.IKE Subconscious Endpoints (Read-only + Proposal)

These endpoints are consumed by AVA-007 to obtain interpretations.  
REV.IKE never writes directly to JSONL.

### `POST /internal/revike/interpret`

Request (by AVA-007):

```json
{
  "memory_ids": ["mem_123", "mem_456"],
  "query": "Why did the swarm stall?",
  "include_alternative_framings": true
}
```

Response (REV.IKE):

```json
{
  "observations": [
    "The swarm encountered an incompatible bracket - a known pattern from previous jobs."
  ],
  "insights": [
    "Delays often correlate with missing visual instructions in the portal."
  ],
  "questions": [
    "Would pre-dispatch spatial tagging reduce this failure mode?"
  ],
  "alternative_framings": [
    "Reframe the stall as an opportunity to update the knowledge base."
  ]
}
```

### `POST /internal/revike/propose`

Generates an `ObservationProposal` that AVA-007 may accept or reject.

Request:

```json
{
  "context_memory_ids": ["mem_123"],
  "focus": "suggest new memory to log"
}
```

Response:

```json
{
  "type": "observation_proposal",
  "source": "REV.IKE",
  "timestamp": 1717600000000,
  "content": {
    "interpretation": "The bracket incompatibility suggests a missing step in the assembly guide.",
    "proposed_memory_content": {
      "type": "insight",
      "content": "Bracket type X requires pre-drilling - add to pre-dispatch checklist.",
      "tags": ["process_improvement"]
    }
  },
  "confidence": 0.85
}
```

### AVA-007 Memory Endpoints (Write)

Only these endpoints may append to JSONL.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/memory` | Accepts a `MemoryRecord` (signed by AVA-007) and appends to JSONL |
| POST | `/memory/accept-proposal` | Accepts an `ObservationProposal` and converts it to a `MemoryRecord` |
| POST | `/memory/reject-proposal` | Logs rejection (to audit) but does not append to JSONL |

All write endpoints require DID signature and pass through Tashi consensus.

## Error Handling
- 200: Success
- 400: Malformed request (for example invalid JSONL)
- 401: Missing or invalid signature
- 404: Memory/timeline not found
- 409: Branch conflict (parent hash mismatch)
- 500: Internal error (logged to audit)

## Rate Limits
- Write: 100 requests per second per DID
- Read: 1000 requests per second per DID

## SDKs
- TypeScript: npm install @ava-007/membrain-sdk
- Python: pip install ava-membrain

TypeScript example:

```typescript
import { MemBrainClient } from "@ava-007/membrain-sdk";

const client = new MemBrainClient({
  nodeDid: "did:ava:my-surface",
  privateKey: process.env.PRIVATE_KEY,
});

const memory = await client.writeMemory({
  type: "user_action",
  content: "Clicked book button",
});

const state = await client.recall(memory.timestamp);
```

## Versioning
The API follows semantic versioning. Breaking changes increment the major version (for example /v2). Current stable version is v1.
