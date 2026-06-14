"""
Core mesh coordinator for the QAG-MemBrain fast_mesh layer (LAYER 2).

FAStMesh is the central coordinator that wires together:

* :class:`ContentDeduplicator` — SHA-256 content-addressable dedup
* :class:`CacheTierManager` — L1 / L2 / L3 tiered cache
* :class:`RateGovernor` — per-provider token-bucket rate limiting

Store path::

    data -> compute hash -> dedup check -> rate-govern -> write L1→L2→L3

Retrieve path::

    hash -> search L1 → L2 → L3 -> promote on hit

Reference counting is tracked via the deduplicator.  When ``delete`` is
called the ref-count is decremented; only when it hits zero is the data
actually removed from the cache tiers.
"""

import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from .deduplication import ContentDeduplicator
from .cache_tier import CacheTierManager, L1Cache, L2Cache, L3Cache
from .rate_governor import RateGovernor


@dataclass
class MeshMetadata:
    """Metadata associated with a stored content block."""
    hash: str
    size: int
    content_type: str
    created_at: str
    provider: str
    references: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hash": self.hash,
            "size": self.size,
            "content_type": self.content_type,
            "created_at": self.created_at,
            "provider": self.provider,
            "references": self.references,
        }


class FAStMesh:
    """
    Free API Storage Mesh — central coordinator.

    Parameters
    ----------
    provider:
        Which storage provider to account against the rate governor.
        One of ``'r2'``, ``'ipfs'``, ``'local'``.
    l1_max_mb:
        Maximum size in MiB for the L1 (in-memory) cache.
    l2_db_path:
        Path to the SQLite database for the L2 cache.  ``None`` creates a
        temp file.
    l3_base_dir:
        Directory for the L3 (filesystem) cache.  ``None`` creates a temp
        directory.
    rate_governor:
        Optional pre-configured :class:`RateGovernor`.  If ``None`` a fresh
        one with default provider limits is created.
    deduplicator:
        Optional pre-configured :class:`ContentDeduplicator`.  If ``None``
        a fresh one is created.
    """

    def __init__(
        self,
        provider: str = "r2",
        l1_max_mb: int = 64,
        l2_db_path: Optional[str] = None,
        l3_base_dir: Optional[str] = None,
        rate_governor: Optional[RateGovernor] = None,
        deduplicator: Optional[ContentDeduplicator] = None,
    ) -> None:
        if provider not in ("r2", "ipfs", "local"):
            raise ValueError(f"Unsupported provider: {provider!r}")

        self._provider = provider
        self._dedup = deduplicator if deduplicator is not None else ContentDeduplicator()
        self._governor = rate_governor if rate_governor is not None else RateGovernor()

        l1 = L1Cache(max_size_mb=l1_max_mb)
        l2 = L2Cache(db_path=l2_db_path)
        l3 = L3Cache(base_dir=l3_base_dir)
        self._cache = CacheTierManager(l1=l1, l2=l2, l3=l3)

    # ------------------------------------------------------------------
    # Properties — expose sub-components for advanced use
    # ------------------------------------------------------------------

    @property
    def deduplicator(self) -> ContentDeduplicator:
        return self._dedup

    @property
    def cache(self) -> CacheTierManager:
        return self._cache

    @property
    def rate_governor(self) -> RateGovernor:
        return self._governor

    @property
    def provider(self) -> str:
        return self._provider

    # ------------------------------------------------------------------
    # Core CRUD
    # ------------------------------------------------------------------

    def store(self, data: bytes, content_type: str = "application/octet-stream") -> str:
        """
        Store *data* in the mesh and return its content hash.

        Steps:
        1. Compute SHA-256 hash.
        2. If already stored (dedup hit), increment ref-count only.
        3. Otherwise, check rate governor for the configured provider.
        4. Write through L1 → L2 → L3.
        5. Register in the deduplicator.
        """
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError(f"data must be bytes-like, got {type(data).__name__}")

        content_hash = self._dedup.compute_hash(data)

        # Fast path — already stored
        if self._dedup.is_stored(content_hash):
            self._dedup.register(content_hash, {
                "size": len(data),
                "content_type": content_type,
            })
            return content_hash

        # Rate limit check
        if not self._governor.acquire(self._provider):
            raise RuntimeError(
                f"Rate limit exceeded for provider {self._provider!r}"
            )

        # Write through the cache tiers
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        metadata = {
            "content_type": content_type,
            "created_at": now,
            "provider": self._provider,
        }
        self._cache.put(content_hash, data, metadata)

        # Register in dedup index
        self._dedup.register(content_hash, {
            "size": len(data),
            "content_type": content_type,
            "created_at": now,
            "provider": self._provider,
        })

        return content_hash

    def retrieve(self, content_hash: str) -> Optional[bytes]:
        """
        Retrieve data by its content hash.

        Searches L1 → L2 → L3.  On a lower-tier hit the data is promoted
        to L1 for faster subsequent access.
        """
        result = self._cache.get_with_tier(content_hash)
        if result is None:
            return None

        data, metadata, tier_idx = result

        # Promote to L1 if found in a lower tier
        if tier_idx > 0:
            self._cache.promote(content_hash, from_tier=tier_idx, to_tier=0)

        return data

    def delete(self, content_hash: str) -> bool:
        """
        Delete content by hash.

        Decrements the reference count.  Only when the count reaches zero
        is the data actually removed from the cache tiers.
        """
        if not self._dedup.is_stored(content_hash):
            return False

        # Deregister returns True even when ref count just decrements
        still_exists = self._dedup.is_stored(content_hash)
        self._dedup.deregister(content_hash)

        # Check if fully dereferenced
        if not self._dedup.is_stored(content_hash):
            self._cache.delete(content_hash)

        return True

    def exists(self, content_hash: str) -> bool:
        """Return True if *content_hash* is stored in the mesh."""
        return self._dedup.is_stored(content_hash)

    def get_metadata(self, content_hash: str) -> Optional[MeshMetadata]:
        """
        Return metadata for *content_hash*, or ``None`` if not stored.
        """
        entry = self._dedup.get_entry(content_hash)
        if entry is None:
            return None

        return MeshMetadata(
            hash=entry["hash"],
            size=entry["size"],
            content_type=entry.get("content_type", "application/octet-stream"),
            created_at=entry.get("created_at", ""),
            provider=entry.get("provider", "unknown"),
            references=entry.get("reference_count", 1),
        )

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def get_dedup_stats(self) -> dict:
        """Return deduplication statistics as a plain dict."""
        return self._dedup.get_stats().to_dict()

    def flush(self) -> None:
        """Clear all cache tiers (dedup index is preserved)."""
        self._cache.flush_all()

    def __len__(self) -> int:
        """Number of unique content entries in the dedup index."""
        return len(self._dedup)
