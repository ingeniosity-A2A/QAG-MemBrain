"""
QAG-MemBrain fast_mesh layer (LAYER 2: FREE API STORAGE MESH).

Provides free-tier API storage (Cloudflare R2, IPFS pinning, etc.) with
content-addressable deduplication, tiered caching, and rate limiting.

Quick start::

    from ava007.membrain.fast_mesh import FAStMesh

    mesh = FAStMesh(provider="r2")
    h = mesh.store(b"hello world", content_type="text/plain")
    data = mesh.retrieve(h)
    assert data == b"hello world"
"""

from .fast_mesh import FAStMesh, MeshMetadata
from .deduplication import ContentDeduplicator, DedupStats
from .cache_tier import CacheTierManager, L1Cache, L2Cache, L3Cache
from .rate_governor import RateGovernor
from .serialization import GraphMeshSerializer

__all__ = [
    "FAStMesh",
    "MeshMetadata",
    "ContentDeduplicator",
    "DedupStats",
    "CacheTierManager",
    "L1Cache",
    "L2Cache",
    "L3Cache",
    "RateGovernor",
    "GraphMeshSerializer",
]
