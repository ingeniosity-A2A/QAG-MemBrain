# Tests & Benchmarks

Ensure deterministic replay, Tashi consensus, and API correctness.

## Subdirectories
- `/unit` – Isolated tests for JSONL, tween atoms, DAG validation.
- `/integration` – End‑to‑end flows: JSONL → Tashi → GSAP → recall.
- `/benchmark` – Performance: memory compression ratio, sync latency, replay speed.

## Key Test Suites
- `deterministic_replay.test.ts` – Same timeline → same output.
- `offline_queue.test.ts` – Tashi queue flushes correctly.
- `api_contract.test.ts` – SDK ↔ API compatibility.
