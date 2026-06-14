"""
ava007.membrain.ion_memory — LAYER 1: Ion Memory Emulation

Emulates memristor filament states for the Ava007 cognitive runtime.
Provides persistent memory with MLC conductance levels, endurance tracking,
multi-tier persistence, and content-addressable snapshots.

Public API
----------
IonMemoryStore    Core filament state store (CRUD + events + endurance gating)
FilamentStore     SQLite/LMDB/RocksDB persistent backend
MLCEmulation      8-level (3-bit) conductance emulation
EnduranceTracker  Write-cycle counting and fatigue model
PersistenceManager  L1 (dict) / L2 (SQLite) / L3 (FASt Mesh) tiered storage
SnapshotManager   Content-addressable epoch snapshots
"""

from .endurance import EnduranceTracker, FilamentHealth, EnduranceRecord
from .filament_store import (
    FilamentStore,
    FilamentStoreBase,
    LMDBFilamentStore,
    RocksDBFilamentStore,
)
from .ion_memory import IonMemoryStore, IonEvent, IonEventKind
from .mlc_emulation import MLCEmulation
from .persistence import PersistenceManager, L1Tier, L2Tier, L3Tier, Tier
from .snapshots import SnapshotManager, SnapshotRecord

__all__ = [
    # Core store
    "IonMemoryStore",
    "IonEvent",
    "IonEventKind",
    # Backend
    "FilamentStore",
    "FilamentStoreBase",
    "LMDBFilamentStore",
    "RocksDBFilamentStore",
    # MLC
    "MLCEmulation",
    # Endurance
    "EnduranceTracker",
    "FilamentHealth",
    "EnduranceRecord",
    # Persistence
    "PersistenceManager",
    "L1Tier",
    "L2Tier",
    "L3Tier",
    "Tier",
    # Snapshots
    "SnapshotManager",
    "SnapshotRecord",
]
