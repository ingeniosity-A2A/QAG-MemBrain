# GSAP Temporal Orchestration (Layer 2)

Deterministic timeline engine that converts JSONL memories into tween atoms.

## Subdirectories
- /gsap: Timeline management, tween evaluation, easing-probability handling
- /timeline: Timeline serialization/deserialization
- /serialization: JSONL and tween conversion

## Key Functions
- ingest(memory: MemoryRecord): TweenAtom
- recall(timestamp: number): State
- branch(decisionPoint: number, mutations: TweenAtom[]): Timeline

## Determinism Guarantee
Same timeline definitions and same start time produce identical state at time t.
