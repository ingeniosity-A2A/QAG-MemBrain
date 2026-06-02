# GreenSock Animation Platform (GSAP) Temporal Orchestration (Layer 2)

Deterministic timeline engine. Converts JSONL memories into tween atoms.

## Subdirectories
- `/gsap` – Core timeline management, tween atom evaluation, easing as probability.
- `/timeline` – Timeline serialization/deserialization, persistence to JSONL.
- `/serialization` – Convert between JSONL memory and GSAP tween atoms.

## Key Functions
- `ingest(memory: MemoryRecord) -> TweenAtom`
- `recall(timestamp: number) -> State`
- `branch(decisionPoint: number, mutations: TweenAtom[]) -> Timeline`

## Determinism Guarantee
Same timeline definitions + same start time → identical state at any future `t`.
