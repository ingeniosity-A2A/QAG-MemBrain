# Consumption API (Imported Context)

This repository consumes a versioned API contract for memory write, recall,
branch simulation, audit retrieval, and Tashi sync.

Canonical imported source was provided in uploaded docs.

## Recommended Endpoints

- `POST /memory`
- `GET /recall`
- `POST /branch`
- `GET /audit`
- `POST /tashi/sync`
- `WS /timeline`

## Authentication

- Ed25519 DID signatures on all requests.

## Notes

Use this file as an index and compatibility anchor.
Place full normative endpoint specs under `interfaces/api/` as implementation matures.
