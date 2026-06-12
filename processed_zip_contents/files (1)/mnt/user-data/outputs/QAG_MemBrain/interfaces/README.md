# /interfaces — Public API and SDKs

The only boundary surface packages are permitted to cross.
Nothing in `ava-surface` or `ava-runtime` imports from `/memory`, `/tashi`,
`/temporal`, or `/brain` directly. All access goes through here.

## /api
REST + WebSocket server. Implements all endpoints in `CONSUMPTION_API.md`.
DID signature verification middleware on every route.

## /sdk
### /sdk/ts
```bash
npm install @ava-007/membrain-sdk
```
Handles signing, serialization, WebSocket reconnection, typed responses.

### /sdk/python
```bash
pip install ava-membrain
```
Sync and async (asyncio) variants for agents and data pipelines.

## Versioning
Current stable: `v1`. Path prefix: `/v1/`.
Breaking changes require a new path prefix and migration notice in `/docs/`.
