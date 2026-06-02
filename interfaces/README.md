# Public API & SDK

How surface packages (UI, runtime, external agents) consume QAG_MemBrain.

## Subdirectories
- `/api` – REST + WebSocket endpoints (Node.js/Express or Next.js API routes).
- `/sdk` – TypeScript/Python client libraries for easy integration.

## Core Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/memory` | Write a new JSONL memory (signed) |
| GET | `/recall?t=...` | Reconstruct state at temporal coordinate |
| GET | `/audit?session=...` | Retrieve audit log |
| POST | `/branch` | Create branch from decision point |
| WS | `/timeline` | Subscribe to live timeline updates |

## Authentication
DID signatures on every request. SDKs handle signing automatically.
