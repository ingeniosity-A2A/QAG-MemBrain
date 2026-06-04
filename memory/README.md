# Memory Substrate (Layer 0)

## Memory Creation Rule (Dual-Consciousness)

**Only AVA-007 may authorize memory creation.**

- REV.IKE may create `ObservationProposal` objects (see `/docs/DUAL_CONSCIOUSNESS_CONTRACT.md`).
- AVA-007 **must** explicitly accept a proposal before it becomes a `MemoryRecord`.
- Accepted records are appended to `ledger.jsonl` and signed.
- Rejected proposals are discarded (not stored in JSONL - only logged to audit).

### Implementation

```typescript
// Allowed
class AVAAuthority {
  acceptProposal(proposal: ObservationProposal): MemoryRecord {
    // validate proposal
    const memory = { ...proposal.content.proposed_memory_content, source: "AVA-007" };
    return this.jsonl.append(memory);
  }
}

// Forbidden
class REVIKEActor {
  writeMemoryDirectly() { /* violates dual-consciousness contract */ }
}
```

Any code that attempts direct memory write from outside AVA-007 will be rejected by the Architecture Gatekeeper.

JSONL atomic memory is the single source of truth.

## Subdirectories
- /jsonl: Core JSONL schema, read/write utilities, validation
- /audit: Immutable audit logs (inputs, outputs, reasoning)
- /learning: Cortex learning outputs (routing profiles, policy refinements, context models)

## Key Interfaces
- append(memory: MemoryRecord): void
- query(filter: QueryFilter): AsyncIterable<MemoryRecord>
- verify(signature: string): boolean

## Golden Rule
One JSON object equals one atomic memory. Never store whole documents as memory truth.
