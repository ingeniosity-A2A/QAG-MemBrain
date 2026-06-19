EXISTING RUNTIME CONTEXT

Current State

The S25 Ultra is already operating as a live AVA007 node.

Environment:

- Device: Samsung Galaxy S25 Ultra
- Runtime: Termux
- Existing model: Gemma 2B
- Existing repository: Legacy AVA007 repository
- Status: Operational proof-of-concept
- Purpose: Current authority node and development sandbox

---

Architectural Role

The S25 Ultra is not a target deployment.

The S25 Ultra is the existing Authority Node.

Responsibilities:

- AVA007 orchestration
- Governance evaluation
- Tashi memory access
- Context assembly
- BEEP coordination
- Operator interaction

---

New Repository Objective

The new repository is NOT a replacement for the current S25 runtime.

The new repository evolves the architecture into:

- Sovereign Context Runtime
- QAG-MemBrain integration
- Arrow propagation
- GSAP timeline governance
- WebLLM runtime abstraction
- VibeThinker support
- S26 execution node support

---

Compatibility Requirement

All new architecture must preserve compatibility with:

- Existing Termux deployment
- Existing Gemma 2B runtime
- Existing AVA007 workflows
- Existing Tashi memory structures

Avoid breaking current production behavior.

---

Migration Strategy

Phase 1:
Keep Gemma 2B operational on S25.

Phase 2:
Introduce WebLLM runtime abstraction.

Phase 3:
Add VibeThinker provider.

Phase 4:
Move execution workloads to S26.

Phase 5:
Promote S25 to full Authority Node.

At no point should the current S25 deployment be assumed empty or rebuilt from scratch.

Treat it as a live system undergoing evolutionary migration.

---

Current Live Components (Must Preserve)

S25 Termux Deployment:
- AVA007 coordination layer (legacy)
- Gemma 2B inference
- Tashi working memory
- Basic governance
- BEEP mesh connectivity
- Cloudflare tunnel
- Operator console

Data Structures:
- Existing Tashi memory schema
- Existing audit log format
- Existing context node format
- Existing policy definitions

Workflows:
- Photo → detection → quote → booking
- Memory consolidation
- Timeline recording
- Authority decisions

---

Integration Points for New Architecture

1. WebLLM Runtime Abstraction Layer
   - Wraps existing Gemma 2B
   - Provides common interface
   - Enables VibeThinker swap

2. GovernanceContract.ts
   - Enhances (not replaces) existing governance
   - Adds formal evaluation
   - Preserves existing decisions

3. ContextAssembler.ts
   - Compatible with existing context format
   - Adds compression strategies
   - Maintains backward compatibility

4. Arrow Propagation
   - Adds to existing reactive updates
   - Does not break current polling

5. GSAP Timeline
   - Extends existing timeline
   - Adds lifecycle states
   - Preserves history

---

What Must NOT Be Assumed

- ❌ S25 is empty/clean slate
- ❌ Gemma 2B can be removed immediately
- ❌ Tashi memory can be restructured
- ❌ Existing workflows can be changed
- ❌ Operator workflows can be disrupted
- ❌ Current audit trail can be reset

---

What CAN Be Built New

- ✅ WebLLM abstraction layer
- ✅ VibeThinker provider (alongside Gemma)
- ✅ S26 execution node
- ✅ Enhanced governance policies
- ✅ Arrow context propagation
- ✅ GSAP timeline governance
- ✅ Zero-copy memory bridges
- ✅ NPU acceleration layer
- ✅ Model registry
- ✅ Enhanced search/voice/code policies

---

Validation Checklist for Each Phase

Phase 1-2 (WebLLM Abstraction):
[ ] Gemma 2B still runs
[ ] Existing workflows unchanged
[ ] Memory structures intact
[ ] Audit trail continuous

Phase 3 (VibeThinker):
[ ] Gemma 2B fallback works
[ ] VibeThinker parallel inference
[ ] A/B comparison enabled
[ ] No production traffic to VibeThinker yet

Phase 4 (S26):
[ ] S25 authority unchanged
[ ] Execution delegates to S26
[ ] Memory syncs both directions
[ ] Timeline consistent across nodes

Phase 5 (Full Authority):
[ ] S25 runs full GovernanceContract
[ ] S25 runs ContextAssembler
[ ] S26 runs VibeThinker + WebLLM
[ ] Both nodes operational

---

Key Principle

The architecture evolves the live system.
It does not replace it.

Every new component must prove itself
alongside the existing production runtime
before taking over responsibilities.