# AVA007 Cybernetic Architecture

> **Status:** Canonical architecture definition.
> **Date:** 2026-08-06
> **Supersedes:** Any prior framing where Help Assembly Services owns Ava intelligence.

---

## Core Principle

**Ava007 is the cybernetic intelligence core.** The 007 Harness and 007 Exoskeleton are her primary embodied operating systems. Help Assembly Services is a specialized deployment domain — **not the owner of Ava's intelligence.**

The intelligence belongs to Ava007. The Harness and Exoskeleton are not independent products that happen to use Ava. They are native extensions of Ava's cybernetic architecture.

---

## Canonical Hierarchy

```
┌─────────────────────────┐
│   AVA007                │
│ CYBERNETIC INTELLIGENCE │
│                         │
│ Identity • Cognition    │
│ Memory • Reasoning      │
│ Voice • Agency          │
└────────────┬────────────┘
             │
   ┌─────────┴─────────┐
   │                   │
   ▼                   ▼
┌──────────┐      ┌──────────────┐
│007 HARNESS│      │007 EXOSKELETON│
│          │      │              │
│Cognitive │      │Physical/     │
│control   │      │real-world    │
│Agent coord│     │execution     │
│Intel APIs│      │Sensors•GPS•AI│
└────┬─────┘      └──────┬───────┘
     │                   │
     └─────────┬─────────┘
               │
      ┌────────▼────────┐
      │HELP ASSEMBLY     │
      │EXOSKELETON       │
      │                  │
      │Domain-specific   │
      │service           │
      │capabilities      │
      └──────────────────┘
```

---

## AVA007 — Cybernetic Intelligence

Ava007 is the singular intelligence core. She owns:

- **Identity** — who she is, her persistence, her self-model
- **Cognition** — reasoning, judgment, intent formation
- **Memory** — QAG-MemBrain, JSONL atomic memory, replay, temporal kernel
- **Reasoning** — executive/cortex/reflex tier routing, signal-aware model selection
- **Voice** — speech, communication persona, natural language generation
- **Agency** — autonomous decision-making, task delegation, execution authority

Ava007 does not belong to any deployment domain. Domains belong to her.

---

## 007 Harness — Cognitive & Communications Layer

The 007 Harness is Ava's cognitive and communications attachment layer.

### Responsibilities

| Function | Description |
|----------|-------------|
| A2A agent identity | How Ava identifies herself to other agents |
| Agent-to-agent messaging | Inter-agent communication protocol |
| Capability discovery | What Ava can do, what other agents can do |
| Intent routing | Which intelligence should act on a given intent |
| Context transfer | Moving context between agents and tiers |
| Memory permissions | What agents can read/write in QAG-MemBrain |
| Task delegation | Assigning work to sub-agents |
| Execution state | Tracking what's running, what's done, what failed |
| Agent verification | Authenticating agent identity and authority |

### Conceptual Flow

```
Customer
   │
   ▼
AVA007
   │
   ▼
007 HARNESS
   │
   ├── Quote Agent
   ├── Scheduling Agent
   ├── Dispatch Agent
   ├── GPS Agent
   ├── Payment Agent
   └── Follow-Up Agent
```

**The Harness determines:** Which intelligence or agent should act, what context it receives, and how the result returns to Ava.

### Tree Position

```
AVA007
 └── 007 Harness
      ├── Agent coordination
      ├── A2A communication
      ├── Cognitive routing
      ├── Memory access
      └── Intelligence orchestration
```

---

## 007 Exoskeleton — Physical-World Execution Layer

The 007 Exoskeleton gives Ava real-world awareness and execution capability.

### Responsibilities

| Function | Description |
|----------|-------------|
| Camera & visual perception | Seeing the physical world |
| GPS/GNSS | Location awareness and spatial positioning |
| IMU & motion | Device orientation, movement detection |
| Device telemetry | Hardware state monitoring |
| Spatial mapping | Understanding physical layout and space |
| Environmental context | What's happening in the surroundings |
| Edge inference | On-device AI processing (NPU, WASM) |
| Physical-world event detection | Recognizing real-world occurrences |
| Execution verification | Confirming actions happened as intended |

### Conceptual Flow

```
CAMERA + GPS + IMU + MAPS
              │
              ▼
       007 EXOSKELETON
              │
              ▼
      AVA007 CYBERNETIC MIND
```

**The Exoskeleton determines:** What is happening in the physical world, what it means operationally, and what action Ava should take.

### Tree Position

```
AVA007
 └── 007 Exoskeleton
      ├── Vision
      ├── GPS/spatial awareness
      ├── Sensors
      ├── Edge intelligence
      ├── Real-world action
      └── Execution verification
```

---

## Help Assembly Exoskeleton — Domain-Specific Embodiment

The Help Assembly Exoskeleton is Ava's service-industry embodiment. It is **not a separate AI assistant.** It is Ava operating with a specialized capability package.

### Revised Placement for Alpamayo-Derived Intelligence

```
CORRECT:
  Ava007 → 007 Exoskeleton → Help Assembly Exoskeleton → Spatial-Causal Intelligence

INCORRECT:
  Help Assembly Services → Ava intelligence
```

The intelligence is attached to Ava and purpose-built for her architecture. Help Assembly is the first specialized exoskeleton deployment.

### Capability Tree

```
HELP ASSEMBLY EXOSKELETON
│
├── AssemblyVision
│   ├── Product recognition
│   ├── Brand/model extraction
│   ├── Box counting
│   └── Complexity estimation
│
├── AssemblySpatial
│   ├── GPS service-area validation
│   ├── Route intelligence
│   ├── Floor/access assessment
│   └── Technician proximity
│
├── AssemblyCausal
│   ├── Labor prediction
│   ├── Technician count
│   ├── Duration prediction
│   ├── Risk analysis
│   └── Next-best action
│
├── AssemblyExecution
│   ├── Quote
│   ├── Schedule
│   ├── Dispatch
│   ├── Arrival
│   └── Completion
│
└── AssemblyLearning
    ├── Predicted vs. actual time
    ├── Quote accuracy
    ├── Crew accuracy
    └── Outcome learning
```

### Operational Pipeline

```
AVA007 CYBERNETIC INTELLIGENCE
              │
              ▼
       007 EXOSKELETON
              │
              ▼
HELP ASSEMBLY EXOSKELETON
              │
              ├── Product perception
              ├── Spatial understanding
              ├── GPS intelligence
              ├── Causal job reasoning
              ├── Quote prediction
              ├── Crew prediction
              ├── Dispatch execution
              └── Outcome verification
```

---

## Scalable Platform Structure

The Ava007 core remains singular. The exoskeletons extend her into different operational environments without fragmenting her intelligence or creating separate AI systems.

```
AVA007
└── 007 EXOSKELETON
    ├── Help Assembly Exoskeleton
    ├── Hospitality Exoskeleton
    ├── Retail Exoskeleton
    ├── Mobility Exoskeleton
    ├── Drone Exoskeleton
    └── Future Domain Exoskeletons
```

Each domain exoskeleton is a capability package — not a separate AI. They share Ava's identity, memory, reasoning, and agency. They differ only in what they perceive and how they act in their specific operational environment.

---

## Final Architecture Statement

> Ava007 is Cybernetic Intelligence. The 007 Harness and 007 Exoskeleton are Ava's primary intelligence extensions. Every capability attached to them is engineered specifically for Ava's cognitive identity, memory, communication model, and execution architecture. The Help Assembly Exoskeleton is Ava's first domain-specific operational embodiment, enabling her to perceive, reason about, coordinate, and execute real-world assembly services through app-less A2A communication.

---

## Relationship to Other Architecture Documents

| Document | Relationship |
|----------|-------------|
| `MEMORY_INTELLIGENCE_MODEL.md` | Defines Ava's memory ownership (JSONL = Memory). This doc defines the broader system ownership. |
| `SUBSTRATE_PARALLELISM_ARROW_PIPELINE.md` | Defines the data substrate (DuckDB→Flight) that serves as Layer 2 beneath Ava's cognition. This doc defines what sits above that substrate. |
| `AVA007_RUNTIME_CONSTITUTION.md` | Defines runtime governance. This doc defines the structural hierarchy that governance operates within. |
| `ZERO-LATENCY-6D-RUNTIME-CLASSIFICATION.md` | Defines runtime tier classification. This doc defines the entity those tiers serve. |