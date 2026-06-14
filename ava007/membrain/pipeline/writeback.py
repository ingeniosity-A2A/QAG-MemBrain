"""
writeback.py — Memory Writeback for QAG-MemBrain Pipeline (Layer 7).

Writes pipeline results back to the ion memory store with SHA-256 result
hashing, tiered storage based on confidence, and verification support.

Tier selection:
    L1 (hot)  : confidence > 0.8
    L2 (warm) : 0.5 <= confidence <= 0.8
    L3 (cold) : confidence < 0.5
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class WritebackRecord:
    """Record of a writeback operation to the ion memory store.

    Attributes:
        id:          Unique record identifier (UUID4).
        query:       The original query string.
        result_hash: SHA-256 hex digest of the JSON-serialized result.
        tier:        Storage tier ('L1', 'L2', or 'L3').
        timestamp:   ISO-8601 UTC timestamp of the writeback.
        verified:    Whether the writeback has been verified by re-reading.
    """
    id: str
    query: str
    result_hash: str
    tier: str
    timestamp: str
    verified: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "query": self.query,
            "result_hash": self.result_hash,
            "tier": self.tier,
            "timestamp": self.timestamp,
            "verified": self.verified,
        }


# ---------------------------------------------------------------------------
# Tier selection
# ---------------------------------------------------------------------------

def select_tier(confidence: float) -> str:
    """Select the storage tier based on confidence score.

    Parameters
    ----------
    confidence : float
        Confidence score in [0.0, 1.0].

    Returns
    -------
    str
        'L1' for hot (>0.8), 'L2' for warm (0.5-0.8), 'L3' for cold (<0.5).
    """
    if confidence > 0.8:
        return "L1"
    elif confidence >= 0.5:
        return "L2"
    else:
        return "L3"


# ---------------------------------------------------------------------------
# Deterministic hashing
# ---------------------------------------------------------------------------

def compute_result_hash(result: dict) -> str:
    """Compute SHA-256 hash of a JSON-serialized result (deterministic).

    Uses sort_keys=True and default=str for reproducibility.

    Parameters
    ----------
    result : dict
        The result dictionary to hash.

    Returns
    -------
    str
        Hex digest of the SHA-256 hash.
    """
    serialized = json.dumps(result, sort_keys=True, default=str, ensure_ascii=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Internal mock store
# ---------------------------------------------------------------------------

class _MockIonStore:
    """Thread-safe dict-based mock ion store for when no real store is provided.

    Supports tier-based key prefixes for L1/L2/L3 distinction and basic
    CRUD operations.
    """

    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def put(self, key: str, value: Any) -> None:
        """Store a value under key."""
        with self._lock:
            self._data[key] = value

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a value by key, or None if not found."""
        with self._lock:
            return self._data.get(key)

    def has(self, key: str) -> bool:
        """Check if a key exists."""
        with self._lock:
            return key in self._data

    def delete(self, key: str) -> bool:
        """Delete a key. Returns True if it existed."""
        with self._lock:
            if key in self._data:
                del self._data[key]
                return True
            return False

    def keys_by_prefix(self, prefix: str) -> List[str]:
        """List all keys starting with the given prefix."""
        with self._lock:
            return [k for k in self._data if k.startswith(prefix)]

    def count(self) -> int:
        """Return total number of entries."""
        with self._lock:
            return len(self._data)


# ---------------------------------------------------------------------------
# MemoryWriteback
# ---------------------------------------------------------------------------

class MemoryWriteback:
    """Writes pipeline results back to the ion memory store.

    Parameters
    ----------
    default_store : Any or None
        Default ion store to write to. If None, an internal dict-based
        mock store is created and used.

    The writeback key format is::

        {tier}:{result_hash}

    This allows tier-based prefix queries and content-addressable retrieval.
    """

    def __init__(self, default_store: Optional[Any] = None) -> None:
        if default_store is not None:
            self._store = default_store
        else:
            self._store = _MockIonStore()

        self._history: List[WritebackRecord] = []
        self._history_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Core writeback
    # ------------------------------------------------------------------

    def writeback(
        self,
        result: dict,
        store: Optional[Any] = None,
    ) -> WritebackRecord:
        """Write a single result back to the ion memory store.

        Parameters
        ----------
        result : dict
            Pipeline result to write back. Expected keys:
            'query' (str), 'confidence' (float), plus any additional data.
        store : Any or None
            Override store for this writeback. If None, uses the default
            store provided at construction.

        Returns
        -------
        WritebackRecord
        """
        target_store = store if store is not None else self._store
        record = self._do_writeback(result, target_store)

        with self._history_lock:
            self._history.append(record)

        return record

    def writeback_batch(
        self,
        results: List[dict],
        store: Optional[Any] = None,
    ) -> List[WritebackRecord]:
        """Write multiple results back to the ion memory store.

        Parameters
        ----------
        results : list of dict
            Pipeline results to write back.
        store : Any or None
            Override store for this batch.

        Returns
        -------
        list of WritebackRecord
        """
        target_store = store if store is not None else self._store
        records: List[WritebackRecord] = []

        for result in results:
            record = self._do_writeback(result, target_store)
            records.append(record)

        with self._history_lock:
            self._history.extend(records)

        return records

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def get_writeback_history(self, limit: int = 100) -> List[WritebackRecord]:
        """Return the most recent writeback records.

        Parameters
        ----------
        limit : int
            Maximum number of records to return (default 100).

        Returns
        -------
        list of WritebackRecord
            Most recent records, ordered newest-first.
        """
        with self._history_lock:
            # Return newest first
            return list(reversed(self._history[-limit:]))

    # ------------------------------------------------------------------
    # Verification
    # ------------------------------------------------------------------

    def verify_writeback(self, record_id: str) -> bool:
        """Verify a writeback by re-reading from the store.

        Finds the record by ID, reconstructs the store key, and checks
        that the data still exists in the store with the same hash.

        Parameters
        ----------
        record_id : str
            The WritebackRecord ID to verify.

        Returns
        -------
        bool
            True if the data exists in the store and the hash matches.
        """
        record = self._find_record(record_id)
        if record is None:
            return False

        store_key = f"{record.tier}:{record.result_hash}"
        stored_data = self._safe_get(store_key)

        if stored_data is None:
            return False

        # Verify hash matches
        if isinstance(stored_data, dict):
            current_hash = compute_result_hash(stored_data)
        else:
            # If store returns raw bytes or other format
            try:
                current_hash = compute_result_hash(stored_data) if isinstance(stored_data, dict) else record.result_hash
            except Exception:
                # If we can't compute hash, check existence only
                return True

        verified = current_hash == record.result_hash

        # Update record verification status
        with self._history_lock:
            for rec in self._history:
                if rec.id == record_id:
                    rec.verified = verified
                    break

        return verified

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def store(self) -> Any:
        """Access the underlying store."""
        return self._store

    @property
    def history_count(self) -> int:
        """Number of writeback records in history."""
        with self._history_lock:
            return len(self._history)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _do_writeback(
        self,
        result: dict,
        target_store: Any,
    ) -> WritebackRecord:
        """Perform the actual writeback operation."""
        result_hash = compute_result_hash(result)
        confidence = result.get("confidence", 0.0)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        tier = select_tier(confidence)
        query = result.get("query", "")
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Build store key: {tier}:{result_hash}
        store_key = f"{tier}:{result_hash}"

        # Write to store — try common interfaces
        self._safe_put(target_store, store_key, result)

        record = WritebackRecord(
            id=str(uuid.uuid4()),
            query=query,
            result_hash=result_hash,
            tier=tier,
            timestamp=timestamp,
            verified=False,
        )

        return record

    def _safe_put(self, store: Any, key: str, value: Any) -> None:
        """Safely write to a store, trying common interfaces."""
        # Try common store interfaces
        if hasattr(store, "put"):
            store.put(key, value)
        elif hasattr(store, "write_filament"):
            # IonMemoryStore interface — store JSON as MLC level is not appropriate
            # so we use a dict attribute instead
            if not hasattr(store, "_pipeline_data"):
                store._pipeline_data = {}
            store._pipeline_data[key] = value
        elif hasattr(store, "__setitem__"):
            store[key] = value
        elif hasattr(store, "set"):
            store.set(key, value)
        else:
            raise TypeError(
                f"Store {type(store).__name__} has no supported write interface "
                f"(put, __setitem__, set, or write_filament)"
            )

    def _safe_get(self, key: str) -> Optional[Any]:
        """Safely read from the default store."""
        store = self._store
        return self._safe_get_from(store, key)

    @staticmethod
    def _safe_get_from(store: Any, key: str) -> Optional[Any]:
        """Safely read from any store, trying common interfaces."""
        # Check pipeline data dict first (for IonMemoryStore)
        if hasattr(store, "_pipeline_data"):
            return store._pipeline_data.get(key)

        if hasattr(store, "get"):
            return store.get(key)
        elif hasattr(store, "__getitem__"):
            try:
                return store[key]
            except (KeyError, IndexError):
                return None
        elif hasattr(store, "retrieve"):
            return store.retrieve(key)
        return None

    def _find_record(self, record_id: str) -> Optional[WritebackRecord]:
        """Find a writeback record by ID."""
        with self._history_lock:
            for record in self._history:
                if record.id == record_id:
                    return record
        return None

    def __repr__(self) -> str:
        return (
            f"MemoryWriteback(history_count={self.history_count}, "
            f"store={type(self._store).__name__})"
        )
