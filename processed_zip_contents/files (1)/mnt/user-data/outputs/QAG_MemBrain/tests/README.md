# /tests — Test Harness

All tests are UI-free. No browser, no DOM, no rendering.
The pipeline is verified in complete isolation from presentation.

## /unit
- JSONL schema validation
- Ed25519 signature creation and verification
- Tween atom serialization round-trips
- DAG parent hash chain validation
- Gate confidence threshold logic

## /integration
- `deterministic_replay.test.ts` — Same timeline + t0 → identical state (1000 iterations)
- `offline_queue.test.ts` — Tashi queue flushes on reconnect, no data loss
- `api_contract.test.ts` — SDK <-> API compatibility for all endpoints
- `full_pipeline.test.ts` — NFC tap -> JSONL -> Tashi -> GSAP -> recall -> audit

## /benchmark
- Memory write throughput (atoms/second)
- Tashi gossip propagation latency (2-node and 5-node)
- GSAP recall time at various timeline depths
- Escalation gate decision latency per brain tier

## Running
```bash
npm test              # unit + integration
npm run test:bench    # benchmarks only
npm run test:replay   # deterministic replay only
```
