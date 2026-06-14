"""
QAG-MemBrain — Quantum Atomic GSAP Membrain Framework
8-Layer Cognitive Memory Architecture for Ava007 Edge Nodes

Layers:
  L1: ion_memory    — Filament state store, MLC conductance, endurance
  L2: fast_mesh     — Free API Storage Mesh, dedup, cache tiers
  L3: graphrag      — GQL GraphRAG retrieval, path restrictors
  L4: reinforcement — GRPO/DAPO reinforcement learning
  L5: gsap_temporal — GSAP temporal synchronization
  L6: dualbrain     — DualBrain inference router
  L7: pipeline      — Pipeline orchestration
  L8: hardware      — S25 Ultra hardware unlock
"""

from ava007.membrain.ion_memory import (
    IonMemoryStore,
    FilamentStore,
    MLCEmulation,
    EnduranceTracker,
    PersistenceManager,
    SnapshotManager,
)
from ava007.membrain.fast_mesh import (
    FAStMesh,
    ContentDeduplicator,
    CacheTierManager,
    RateGovernor,
    GraphMeshSerializer,
)
from ava007.membrain.graphrag import (
    GraphRAGRetrieval,
    PropertyGraph,
    PathType,
    GQLLetBindings,
    SchemaValidator,
)
from ava007.membrain.reinforcement import (
    GRPODAPO,
    RewardScorer,
    AsymmetricClipping,
    LossNormalization,
    RLVR,
)
from ava007.membrain.gsap_temporal import CognitiveEpochVisualizer
from ava007.membrain.dualbrain import (
    DualBrainRouter,
    RoutingEngine,
    QueryAugmenter,
    RoutingStrategy,
    RoutingMode,
)
from ava007.membrain.pipeline import (
    MembrainPipeline,
    QueryOrchestrator,
    MemoryWriteback,
    ResponseGenerator,
)
from ava007.membrain.hardware import (
    S25UltraNPU,
    S25UltraADB,
    S25UltraRoot,
    get_hardware_tier,
)

__all__ = [
    # L1: Ion Memory
    "IonMemoryStore", "FilamentStore", "MLCEmulation", "EnduranceTracker",
    "PersistenceManager", "SnapshotManager",
    # L2: FASt Mesh
    "FAStMesh", "ContentDeduplicator", "CacheTierManager", "RateGovernor",
    "GraphMeshSerializer",
    # L3: GraphRAG
    "GraphRAGRetrieval", "PropertyGraph", "PathType", "GQLLetBindings",
    "SchemaValidator",
    # L4: Reinforcement
    "GRPODAPO", "RewardScorer", "AsymmetricClipping", "LossNormalization", "RLVR",
    # L5: GSAP Temporal
    "CognitiveEpochVisualizer",
    # L6: DualBrain
    "DualBrainRouter", "RoutingEngine", "QueryAugmenter",
    "RoutingStrategy", "RoutingMode",
    # L7: Pipeline
    "MembrainPipeline", "QueryOrchestrator", "MemoryWriteback", "ResponseGenerator",
    # L8: Hardware
    "S25UltraNPU", "S25UltraADB", "S25UltraRoot", "get_hardware_tier",
]
