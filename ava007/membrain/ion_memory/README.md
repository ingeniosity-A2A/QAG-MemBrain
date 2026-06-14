# Layer 1: Ion Memory Emulation

> QAG-MemBrain — Ava007 Cognitive Runtime

## Overview

The **ion_memory** layer emulates memristor filament states to provide
persistent, neuromorphic memory for the Ava007 cognitive runtime.  It models
the conductance levels, write endurance, and tiered persistence of physical
ReRAM / memristor devices while remaining pure-Python for portability.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                 IonMemoryStore                    │
│   (core CRUD, event emission, endurance gating)  │
├──────────────┬──────────────┬────────────────────┤
│  MLCEmulation│ EnduranceTracker  PersistenceMgr  │
│  (0-7 levels)│ (100k cycles)   (L1/L2/L3)       │
├──────────────┴──────────────┴────────────────────┤
│              FilamentStore (SQLite)               │
├──────────────────────────────────────────────────┤
│              SnapshotManager (SHA-256)            │
└──────────────────────────────────────────────────┘
```

## Components

| Module | Class | Purpose |
|--------|-------|---------|
| `ion_memory.py` | `IonMemoryStore` | Core filament CRUD with events & endurance gating |
| `filament_store.py` | `FilamentStore` | SQLite / LMDB / RocksDB persistent backend |
| `mlc_emulation.py` | `MLCEmulation` | 8-level (3-bit) conductance/resistance mapping |
| `endurance.py` | `EnduranceTracker` | Write-cycle counting and fatigue model |
| `persistence.py` | `PersistenceManager` | L1 (dict) / L2 (SQLite) / L3 (FASt Mesh) tiers |
| `snapshots.py` | `SnapshotManager` | Content-addressable epoch snapshots (SHA-256) |

## MLC Conductance Map

| Level | Conductance (μS) | Resistance (kΩ) | Binary |
|-------|------------------|------------------|--------|
| 0 | 1 | 1000.000 | 000 |
| 1 | 2 | 500.000 | 001 |
| 2 | 4 | 250.000 | 010 |
| 3 | 8 | 125.000 | 011 |
| 4 | 16 | 62.500 | 100 |
| 5 | 32 | 31.250 | 101 |
| 6 | 64 | 15.625 | 110 |
| 7 | 128 | 7.813 | 111 |

## Quick Start

```python
from ava007.membrain.ion_memory import IonMemoryStore, MLCEmulation

# Create the store
store = IonMemoryStore()

# Create filaments
store.create_filament("neuron_42", initial_level=3)
store.create_filament("synapse_7", initial_level=5)

# Read / write
level = store.read_filament("neuron_42")  # → 3
store.write_filament("neuron_42", 6)

# Endurance awareness
print(store.fatigue_factor("neuron_42"))   # e.g. 0.99998
print(store.remaining_cycles("neuron_42")) # e.g. 99998

# MLC helpers
mlc = MLCEmulation()
print(mlc.level_to_conductance(6))  # 64.0 μS
print(mlc.level_to_resistance(6))   # 15.625 kΩ

# Clean up
store.close()
```

## Persistence Tiers

```python
from ava007.membrain.ion_memory import PersistenceManager

pm = PersistenceManager()
pm.put("hot_key", "fast_data", tier="L1")   # In-memory
pm.put("warm_key", "durable", tier="L2")     # SQLite
pm.put("cold_key", "archived", tier="L3")    # FASt Mesh / JSON

pm.promote("warm_key", "L2", "L1")  # Copy to faster tier
pm.demote("hot_key", "L1", "L2")    # Copy to slower tier
pm.flush()                           # L1 → L2 bulk flush
pm.close()
```

## Snapshots

```python
from ava007.membrain.ion_memory import IonMemoryStore, SnapshotManager

store = IonMemoryStore()
store.create_filament("x", 4)

snap = SnapshotManager()
rec = snap.create_snapshot(store.store, label="epoch_0")
assert snap.verify_snapshot(rec.id)

# Restore
snap.restore_snapshot(rec.id, store.store)
snap.close()
store.close()
```

## Endurance Model

- **MAX_WRITE_CYCLES** = 100,000 (typical for TaOx/HfO₂ ReRAM)
- **FATIGUE_THRESHOLD** = 0.8 (80% of max cycles = fatigue onset)
- `fatigue_factor(key)` decreases linearly: 1.0 → 0.0
- Writes to **dead** cells (fatigue_factor = 0.0) are blocked
- **Fatigued** cells emit warnings but writes still succeed

## Dependencies

**Python stdlib only** — no external packages required for the SQLite backend.
Optional backends:
- `lmdb` — for LMDB L2 or FilamentStore backend
- `python-rocksdb` — for RocksDB FilamentStore backend

## File Layout

```
ion_memory/
├── __init__.py          # Package exports
├── README.md            # This file
├── ion_memory.py        # Core IonMemoryStore
├── filament_store.py    # SQLite/LMDB/RocksDB backend
├── mlc_emulation.py     # 8-level MLC conductance emulation
├── endurance.py         # Write cycle tracking + fatigue model
├── persistence.py       # L1/L2/L3 tiered persistence
└── snapshots.py         # Content-addressable epoch snapshots
```
