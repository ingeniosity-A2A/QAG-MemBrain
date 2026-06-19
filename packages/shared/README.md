# Public API and SDK

Surface packages and external agents consume QAG_MemBrain through this interface layer.

## Subdirectories
- /api: REST and WebSocket endpoints
- /sdk: TypeScript and Python clients

## Core Endpoints
- POST /memory
- GET /recall
- GET /audit
- POST /branch
- WS /timeline

## Authentication
DID signatures are required on every request.
