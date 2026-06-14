"""
Content-addressable deduplication engine for the QAG-MemBrain fast_mesh layer.

Uses SHA-256 hashing to identify content uniquely. Maintains an in-memory index
mapping content hashes to metadata, tracking reference counts for garbage
collection and computing deduplication savings statistics.
"""

import hashlib
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Any


@dataclass
class DedupEntry:
    """Internal record for a deduplicated content block."""
    hash: str
    size: int
    content_type: str
    created_at: str
    reference_count: int = 1
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DedupStats:
    """Statistics snapshot of the deduplication index."""
    total_entries: int
    total_bytes: int
    saved_bytes: int
    dedup_ratio: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_entries": self.total_entries,
            "total_bytes": self.total_bytes,
            "saved_bytes": self.saved_bytes,
            "dedup_ratio": round(self.dedup_ratio, 6),
        }


class ContentDeduplicator:
    """
    SHA-256 content-addressable deduplication engine.

    Maintains an in-memory index of hash -> metadata. Each unique piece of
    content is identified by its SHA-256 digest. When the same content is
    registered again, the reference count is incremented instead of creating
    a new entry, and the deduplication savings are tracked.

    Thread-safe: all mutations are protected by a reentrant lock.
    """

    def __init__(self) -> None:
        self._index: Dict[str, DedupEntry] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compute_hash(self, data: bytes) -> str:
        """Compute the SHA-256 digest of *data* and return the hex string."""
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError(f"data must be bytes-like, got {type(data).__name__}")
        return hashlib.sha256(data).hexdigest()

    def is_stored(self, hash: str) -> bool:
        """Return True if *hash* is already present in the index."""
        with self._lock:
            return hash in self._index

    def register(self, hash: str, metadata: dict) -> None:
        """
        Register content identified by *hash*.

        If the hash is already known the reference count is incremented and
        the existing entry is returned silently.  Otherwise a new entry is
        created from the supplied *metadata* dict, which must contain at
        least ``size`` and ``content_type`` keys.  An optional ``created_at``
        key is accepted; if absent the current UTC-ish timestamp is used.
        """
        if not isinstance(hash, str) or len(hash) != 64:
            raise ValueError(f"Invalid SHA-256 hash: {hash!r}")

        with self._lock:
            if hash in self._index:
                self._index[hash].reference_count += 1
                return

            size = metadata.get("size", 0)
            if not isinstance(size, int) or size < 0:
                raise ValueError(f"metadata['size'] must be a non-negative int, got {size!r}")

            content_type = metadata.get("content_type", "application/octet-stream")
            created_at = metadata.get("created_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

            extra = {k: v for k, v in metadata.items() if k not in ("size", "content_type", "created_at")}

            entry = DedupEntry(
                hash=hash,
                size=size,
                content_type=content_type,
                created_at=created_at,
                reference_count=1,
                extra=extra,
            )
            self._index[hash] = entry

    def deregister(self, hash: str) -> bool:
        """
        Decrement the reference count for *hash*.

        If the count drops to zero the entry is removed from the index and
        ``True`` is returned.  If the hash was unknown ``False`` is returned.
        If the count is still above zero after decrementing, ``True`` is
        returned (the entry still exists but with a reduced ref-count).
        """
        with self._lock:
            if hash not in self._index:
                return False

            entry = self._index[hash]
            entry.reference_count -= 1

            if entry.reference_count <= 0:
                del self._index[hash]
            return True

    def get_entry(self, hash: str) -> Optional[Dict[str, Any]]:
        """Return a copy of the metadata dict for *hash*, or None."""
        with self._lock:
            entry = self._index.get(hash)
            if entry is None:
                return None
            return {
                "hash": entry.hash,
                "size": entry.size,
                "content_type": entry.content_type,
                "created_at": entry.created_at,
                "reference_count": entry.reference_count,
                **entry.extra,
            }

    def get_stats(self) -> DedupStats:
        """
        Compute deduplication statistics.

        * **saved_bytes** = sum of ``(reference_count - 1) * size`` for every
          entry whose reference count is greater than 1.
        * **dedup_ratio** = ``saved_bytes / (total_bytes + saved_bytes)`` if
          there is any data, else 0.0.  This represents the fraction of
          *would-be* storage that was avoided thanks to deduplication.
        """
        with self._lock:
            total_entries = len(self._index)
            total_bytes = 0
            saved_bytes = 0

            for entry in self._index.values():
                total_bytes += entry.size
                if entry.reference_count > 1:
                    saved_bytes += (entry.reference_count - 1) * entry.size

            gross = total_bytes + saved_bytes
            dedup_ratio = (saved_bytes / gross) if gross > 0 else 0.0

            return DedupStats(
                total_entries=total_entries,
                total_bytes=total_bytes,
                saved_bytes=saved_bytes,
                dedup_ratio=dedup_ratio,
            )

    def clear(self) -> int:
        """Remove all entries and return the count that was cleared."""
        with self._lock:
            count = len(self._index)
            self._index.clear()
            return count

    def __len__(self) -> int:
        with self._lock:
            return len(self._index)

    def __contains__(self, hash: str) -> bool:
        return self.is_stored(hash)
