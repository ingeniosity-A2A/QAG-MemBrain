# LAYER 2: FREE API STORAGE MESH (`fast_mesh`)

The `fast_mesh` layer provides **free-tier API storage** for the Ava007 cognitive runtime. It orchestrates Cloudflare R2, IPFS pinning, and local fallback into a unified content-addressable mesh with automatic deduplication, tiered caching, and rate limiting.

## Architecture

```
                    ┌──────────────────────┐
                    │      FAStMesh        │   ← Central coordinator
                    └──────┬───────────────┘
                           │
            ┌──────────────┼───────────────┐
            │              │               │
   ┌────────▼─────┐ ┌─────▼──────┐ ┌──────▼───────┐
   │ ContentDedup │ │ CacheTier  │ │ RateGovernor │
   │  (SHA-256)   │ │  Manager   │ │ (token-bucket)│
   └──────────────┘ └─────┬──────┘ └──────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
       ┌────▼───┐   ┌────▼───┐   ┌────▼───┐
       │  L1    │   │  L2    │   │  L3    │
       │ InMem  │   │ SQLite │   │  R2/   │
       │ (LRU)  │   │        │   │ IPFS   │
       └────────┘   └────────┘   └────────┘
```

## Components

| File | Class | Purpose |
|---|---|---|
| `fast_mesh.py` | `FAStMesh` | Central coordinator — store, retrieve, delete, exists, get_metadata |
| `deduplication.py` | `ContentDeduplicator` | SHA-256 content-addressable dedup with ref counting |
| `cache_tier.py` | `L1Cache`, `L2Cache`, `L3Cache`, `CacheTierManager` | Tiered cache (in-memory → SQLite → filesystem) |
| `rate_governor.py` | `RateGovernor` | Token-bucket per-provider rate limiting |
| `serialization.py` | `GraphMeshSerializer` | Binary graph serialization (QMG1 format + zlib) |

## Quick Start

```python
from ava007.membrain.fast_mesh import FAStMesh

mesh = FAStMesh(provider="r2")

# Store
content_hash = mesh.store(b"hello world", content_type="text/plain")

# Retrieve
data = mesh.retrieve(content_hash)
assert data == b"hello world"

# Metadata
meta = mesh.get_metadata(content_hash)
print(meta.to_dict())
# {'hash': 'b94d...', 'size': 11, 'content_type': 'text/plain', ...}

# Dedup — same content returns same hash, ref-count increments
h2 = mesh.store(b"hello world", content_type="text/plain")
assert h2 == content_hash
assert mesh.get_metadata(content_hash).references == 2

# Delete — decrements ref count; removes on zero
mesh.delete(content_hash)  # ref = 1, data survives
mesh.delete(content_hash)  # ref = 0, data evicted
```

## Graph Serialization

```python
from ava007.membrain.fast_mesh import GraphMeshSerializer

ser = GraphMeshSerializer()

nodes = [
    {"id": "n1", "label": "concept", "properties": {"name": "AI"}},
    {"id": "n2", "label": "concept", "properties": {"name": "ML"}},
]
edges = [
    {"id": "e1", "source": "n1", "target": "n2", "type": "related_to", "properties": {}},
]

blob = ser.serialize_graph(nodes, edges)
restored_nodes, restored_edges = ser.deserialize_graph(blob)
```

## Rate Limiting

```python
from ava007.membrain.fast_mesh import RateGovernor

gov = RateGovernor()
gov.acquire("r2")          # True (within limit)
gov.configure("custom", rate=10.0, burst=5)
gov.acquire("custom", 3)   # True
```

## Wire Format (QMG1)

```
[4B magic "QMG1"] [2B version] [4B node_count] [4B edge_count]
[4B len][JSON node]... [4B len][JSON edge]...
→ zlib compressed with 1-byte compression flag prefix
```
