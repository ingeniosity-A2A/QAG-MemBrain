# Meta Harness — AMOS v2.1

**Status:** GREENFIELD (placeholder on `mobile-runtime` branch)

The Meta Harness is a **first-class runtime wrapper** that intercepts, validates,
governs, and observes every subsystem interaction in AVA007 AMOS v2.1.

## Implementation split

- **Rust core** → `rust/meta-harness/` (NDK-exposed, called from mobile)
- **TS bindings** → `src/meta/` (called from web shell + Node services)

## Responsibilities

- Observe: real-time monitoring of all flows
- Validate: schema, policy, safety checks before any action
- Confidence Scoring: multi-agent voting and uncertainty quantification
- Conflict Detection & Arbitration: resolve disagreements between pillars
- Policy Enforcement: boundary checks, redaction, ethical guardrails
- Approval & Auditing: log every decision with TASHI receipts; enable replay via GSAP
- Lifecycle Hooks (PRISM-style): ingress, tool execution, state persistence, egress

## Files (planned)

```
src/meta/
├── README.md
├── PLACEHOLDER.manifest.json
├── index.ts                  # TS entry point
├── Interceptor.ts            # Universal interceptor
├── Validator.ts              # Schema + policy validation
├── ConfidenceScorer.ts       # Multi-agent voting
├── Arbitrator.ts             # Conflict resolution
├── PolicyEngine.ts           # Boundary enforcement
├── AuditLogger.ts            # TASHI receipt emission
└── LifecycleHooks.ts         # PRISM-style hooks
```
