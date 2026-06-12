# Quantum Atomic GSAP MemBrain

**Edge‑Native Executive Control for A2A Telecom Networks**<br>
*Implementation of the Prefrontal Turn (arXiv:2605.18535)*

## Overview

The **Quantum Atomic GSAP MemBrain** is a distributed, sovereign intelligence substrate that replaces monolithic cloud LLMs with a **functional dissociation** between posterior knowledge (cloud) and prefrontal executive control (edge). It combines:

- **JSONL atomic memory** (append‑only, cryptographically signed)
- **Tashi DAG consensus** with temporal cognition signatures (`{time, seed}`)
- **Neo4j GraphRAG** with philosophical query transformation
- **LoRa mesh** (ESP32 + RadioLib) for distributed swarm actuation
- **GSAP deterministic temporal reconstruction** (tween atoms, no DOM)
- **Strict authority layering** (L1–L6) enforced at runtime

The system runs primarily on a **Snapdragon 8 Elite** edge host (S25/S26 Ultra) and coordinates a swarm of **ESP32** nodes running RadioLib + SX1262.

## Repository Structure (Canonical)

```text
QAG_MemBrain/
├── src/                              # All TypeScript source
│   ├── contract/                     # Runtime authority guards
│   ├── memory/
│   │   ├── jsonl/                    # Append‑only atomic memory
│   │   ├── vector/                   # SQLite + sqlite‑vec (TaskMemory)
│   │   ├── ingestion/                # YouTube/Whisper pipeline stub
│   │   └── edge/                     # Edge‑only customer vault (SQLite)
│   ├── temporal/                     # GSAP engine, RAF ticker, LiteNotebookLM
│   ├── consensus/tashi/              # Tashi DAG, temporal signatures, gossip
│   ├── graph/neo4j/                  # Atomic Interaction Graph + GraphRAG
│   ├── quantum/                      # InteractionQuantum (extends AtomicMemory)
│   ├── subconscious/                 # Rev.Ike (L5 read‑only interpreter)
│   ├── brain/                        # Ava007 adapter (L6) – thin wrapper over canonical
│   ├── hal/                          # LoRa serial bridge (ESP32)
│   ├── shared/                       # Global TypeScript types
│   └── pipeline_impl.ts              # Main entry point
├── swarm/esp32/                      # ESP32 firmware (RadioLib + SX1262)
├── archive/                          # Legacy migration artifacts
├── data/                             # Runtime JSONL, SQLite, Neo4j logs
├── package.json
├── tsconfig.json
└── README.md
```

## Authority Chain (L1–L6)

| Layer | Directory | Role | Enforcement |
|-------|-----------|------|-------------|
| L1 | `memory/jsonl/` | Append‑only truth | `assertCanWrite()` |
| L2 | `consensus/tashi/` | Signing + DAG | Ed25519 (placeholder), SHA‑256 fingerprint |
| L3 | `temporal/` | Deterministic replay | Pure JS, no DOM |
| L4 | `graph/neo4j/` | Retrieval, depth ≤5 | `enforceMaxDepth()` |
| L5 | `subconscious/` | Read‑only observation | `write/decide/execute` throw |
| L6 | `brain/` + `ava007/` | Sole decision & commit | `assertCanDecide()`, `assertCanWrite()` |

## Getting Started

### Prerequisites

- Node.js 20+ (on edge host – Snapdragon, Termux, or dev machine)
- Neo4j database (local or cloud)
- ESP32 with SX1262/CC1101 module (for swarm nodes)
- (Optional) Serial connection between edge host and ESP32

### Installation

```bash
git clone <repo-url>
cd QAG_MemBrain
npm install
npm run build
```

### Configuration

Create `.env` file (or set environment variables):

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
LORA_SERIAL_PORT=/dev/ttyUSB0   # ESP32 serial device
```

### Running the MemBrain Pipeline

```bash
npm start
```

This starts:

- LoRa bridge (listens for ESP32 packets)
- Tashi DAG node (gossips temporal signatures)
- Neo4j GraphRAG (stores and retrieves Interaction Quanta)
- GSAP engine (idle, ready for timeline reconstruction)

### ESP32 Firmware

1. Open `swarm/esp32/lora_bridge.ino` in PlatformIO or Arduino IDE.
2. Install RadioLib and ArduinoJson libraries.
3. Set your frequency, SF, encryption key.
4. Upload to ESP32.
5. Connect ESP32 to edge host via USB.

## Key Concepts

### Interaction Quantum

Every signal (LoRa packet, NFC tap, user command) becomes an **atomic JSON object** stored in `data/memory.jsonl`. It includes RF metadata (RSSI, SNR, frequency), temporal index (GSAP tick, Doppler), and optional T‑SLAT (4D structured latents).

### Distributed Temporal Coherence

Instead of synchronising full state, Tashi nodes gossip only `{timelineId, time, seed, velocity}`. Every node reconstructs the same GSAP timeline deterministically, achieving consensus with **bytes per second** instead of megabytes.

### Query Transformation (GraphRAG)

When a tactical failure occurs (e.g., “stalled hardware”), the system translates it into a **philosophical query** (“illusion of obstacles”) before retrieving relevant Interaction Quanta from Neo4j. The retrieved “Revelation” provides both a strategic diagnosis and a tactical directive.

### Prefrontal Turn (Edge Executive)

All executive functions (Ava007 decision, Rev.Ike interpretation, Tashi consensus) run locally on the edge host. The cloud is used only for posterior retrieval (Neo4j, long‑term archives). This eliminates feedback latency and preserves high‑fidelity episodic memory.

## Legacy Compatibility

Old directories `brain/`, `retrieval/`, `tashi/` are **deprecated** and exist only as thin adapters re‑exporting from the canonical `src/` locations. They will be removed after two release cycles. New code **must not import** from these legacy paths.

## Testing

```bash
npm test
```

Unit tests cover:

- JSONL append & query
- Tashi vertex validation
- GraphRAG query transformation
- Contract guards (authority violations)

## Deployment

- **Edge host** (Snapdragon 8 Elite): Run Node.js + `npm start` inside Termux or native Linux.
- **Swarm nodes** (ESP32): Flash `lora_bridge.ino`, power via battery.
- **Neo4j**: Can run on the edge host (ARM64) or a lightweight cloud instance.

## Contributing

- Follow the **one owner per domain** rule – do not duplicate functionality.
- All memory writes must go through `JSONLMemoryStore.append()` with a valid layer string.
- New agents must respect L5 (read‑only) / L6 (decision) separation.
- Run `npm run build` and `npm test` before submitting PRs.

## References

- arXiv:2605.18535 – *The Prefrontal Turn: Why Agentic AI Demands Edge‑Native Executive Control*
- Quantum Atomic GSAP MemBrain white paper (this repository)
- RadioLib documentation – [https://radiolib.org](https://radiolib.org)
- NullSec LoRa Mesh Framework (encryption & AODV)

## License

MIT – see LICENSE file.

---

*Last updated: 2026-06-11 – Canonical Quantum Atomic 2026 architecture.*
