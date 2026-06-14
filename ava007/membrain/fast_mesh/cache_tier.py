"""
Tiered cache manager for the QAG-MemBrain fast_mesh layer.

Three cache tiers with increasing persistence but decreasing speed:

* **L1Cache (InMemoryCache)** — process-local dict with LRU eviction.
* **L2Cache (SQLiteCache)** — SQLite-backed cache stored on disk.
* **L3Cache (SimulatedR2Cache)** — filesystem directory simulating R2 / IPFS.

All tiers expose the same interface: ``put``, ``get``, ``delete``,
``contains``, ``evict``.  The ``CacheTierManager`` orchestrates lookup
across tiers (L1 -> L2 -> L3) and can promote items from a lower tier to
a higher one on hit.
"""

import collections
import json
import os
import sqlite3
import tempfile
import threading
import time
from typing import Any, Dict, Optional, Tuple


# ======================================================================
# L1 — In-Memory LRU Cache
# ======================================================================

class L1Cache:
    """
    In-process LRU cache backed by an OrderedDict.

    Parameters
    ----------
    max_size_mb:
        Maximum total data size in megabytes before eviction kicks in.
        Default is 64 MB.
    """

    def __init__(self, max_size_mb: int = 64) -> None:
        self._max_bytes = max_size_mb * 1024 * 1024
        self._current_bytes = 0
        # OrderedDict preserves insertion order; we move items to the end on
        # access so the *first* item is always the least-recently-used.
        self._store: collections.OrderedDict[str, Tuple[bytes, dict]] = collections.OrderedDict()
        self._lock = threading.Lock()

    @property
    def max_size_mb(self) -> int:
        return self._max_bytes // (1024 * 1024)

    def put(self, hash: str, data: bytes, metadata: dict) -> None:
        """Store *data* + *metadata* under *hash*, evicting if necessary."""
        with self._lock:
            # If key already present, remove old entry first (to update size)
            if hash in self._store:
                old_data, _ = self._store[hash]
                self._current_bytes -= len(old_data)
                del self._store[hash]

            entry_size = len(data)
            # Evict LRU items until we have room
            while self._current_bytes + entry_size > self._max_bytes and self._store:
                _, (old_data, _) = self._store.popitem(last=False)
                self._current_bytes -= len(old_data)

            self._store[hash] = (data, metadata)
            self._current_bytes += entry_size
            # Move to most-recently-used end
            self._store.move_to_end(hash)

    def get(self, hash: str) -> Optional[Tuple[bytes, dict]]:
        """Return (data, metadata) or None.  Promotes item to MRU end."""
        with self._lock:
            entry = self._store.get(hash)
            if entry is None:
                return None
            self._store.move_to_end(hash)
            return entry

    def delete(self, hash: str) -> bool:
        """Remove *hash* from the cache.  Returns True if it was present."""
        with self._lock:
            if hash not in self._store:
                return False
            old_data, _ = self._store.pop(hash)
            self._current_bytes -= len(old_data)
            return True

    def contains(self, hash: str) -> bool:
        with self._lock:
            return hash in self._store

    def evict(self) -> int:
        """
        Evict the least-recently-used entry.

        Returns the number of items evicted (0 or 1).  This is a single-step
        eviction; call repeatedly or use ``put`` (which auto-evicts) for bulk
        eviction.
        """
        with self._lock:
            if not self._store:
                return 0
            _, (old_data, _) = self._store.popitem(last=False)
            self._current_bytes -= len(old_data)
            return 1

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._current_bytes = 0

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)


# ======================================================================
# L2 — SQLite-backed Cache
# ======================================================================

class L2Cache:
    """
    SQLite-backed persistent cache.

    The table ``cache_entries`` stores:
    ``hash TEXT PRIMARY KEY, data BLOB, metadata TEXT, accessed_at TEXT``

    Parameters
    ----------
    db_path:
        Path to the SQLite database file.  If ``None`` a temporary file is
        created and will persist until the object is garbage-collected.
    """

    _CREATE_TABLE = """
        CREATE TABLE IF NOT EXISTS cache_entries (
            hash       TEXT PRIMARY KEY,
            data       BLOB NOT NULL,
            metadata   TEXT NOT NULL DEFAULT '{}',
            accessed_at TEXT NOT NULL
        )
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        if db_path is None:
            fd, db_path = tempfile.mkstemp(suffix=".db", prefix="fastmesh_l2_")
            os.close(fd)
        self._db_path = db_path
        # Each thread gets its own connection via check_same_thread=False + lock
        self._lock = threading.Lock()
        self._local = threading.local()
        self._ensure_table()

    def _get_conn(self) -> sqlite3.Connection:
        """Return a thread-local connection."""
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn = conn
        return conn

    def _ensure_table(self) -> None:
        conn = self._get_conn()
        conn.execute(self._CREATE_TABLE)
        conn.commit()

    def put(self, hash: str, data: bytes, metadata: dict) -> None:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        meta_json = json.dumps(metadata, default=str)
        with self._lock:
            conn = self._get_conn()
            conn.execute(
                "INSERT OR REPLACE INTO cache_entries (hash, data, metadata, accessed_at) VALUES (?, ?, ?, ?)",
                (hash, data, meta_json, now),
            )
            conn.commit()

    def get(self, hash: str) -> Optional[Tuple[bytes, dict]]:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute(
                "SELECT data, metadata FROM cache_entries WHERE hash = ?",
                (hash,),
            ).fetchone()
        if row is None:
            return None
        data, meta_json = row
        metadata = json.loads(meta_json)
        # Update accessed_at
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._lock:
            conn.execute(
                "UPDATE cache_entries SET accessed_at = ? WHERE hash = ?",
                (now, hash),
            )
            conn.commit()
        return (bytes(data), metadata)

    def delete(self, hash: str) -> bool:
        with self._lock:
            conn = self._get_conn()
            cursor = conn.execute(
                "DELETE FROM cache_entries WHERE hash = ?",
                (hash,),
            )
            conn.commit()
            return cursor.rowcount > 0

    def contains(self, hash: str) -> bool:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute(
                "SELECT 1 FROM cache_entries WHERE hash = ?",
                (hash,),
            ).fetchone()
        return row is not None

    def evict(self) -> int:
        """
        Evict the single least-recently-accessed entry.

        Returns the number of items evicted (0 or 1).
        """
        with self._lock:
            conn = self._get_conn()
            # Find the oldest-accessed entry
            row = conn.execute(
                "SELECT hash FROM cache_entries ORDER BY accessed_at ASC LIMIT 1"
            ).fetchone()
            if row is None:
                return 0
            conn.execute("DELETE FROM cache_entries WHERE hash = ?", (row[0],))
            conn.commit()
            return 1

    def clear(self) -> None:
        with self._lock:
            conn = self._get_conn()
            conn.execute("DELETE FROM cache_entries")
            conn.commit()

    def __len__(self) -> int:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute("SELECT COUNT(*) FROM cache_entries").fetchone()
        return row[0] if row else 0

    @property
    def db_path(self) -> str:
        return self._db_path


# ======================================================================
# L3 — Simulated R2 / IPFS (filesystem) Cache
# ======================================================================

class L3Cache:
    """
    Filesystem-backed cache simulating Cloudflare R2 / IPFS pinning.

    Each cached item is stored as two files under *base_dir*:
    ``<hash>.data``  — the raw bytes
    ``<hash>.meta``  — JSON metadata

    Parameters
    ----------
    base_dir:
        Root directory for cached files.  Created on init if it doesn't exist.
    """

    def __init__(self, base_dir: Optional[str] = None) -> None:
        if base_dir is None:
            base_dir = tempfile.mkdtemp(prefix="fastmesh_l3_")
        self._base_dir = base_dir
        os.makedirs(self._base_dir, exist_ok=True)

    def _data_path(self, hash: str) -> str:
        return os.path.join(self._base_dir, f"{hash}.data")

    def _meta_path(self, hash: str) -> str:
        return os.path.join(self._base_dir, f"{hash}.meta")

    def put(self, hash: str, data: bytes, metadata: dict) -> None:
        # Write data file
        with open(self._data_path(hash), "wb") as f:
            f.write(data)
        # Write metadata file — add accessed_at
        meta = dict(metadata)
        meta["accessed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(self._meta_path(hash), "w", encoding="utf-8") as f:
            json.dump(meta, f, default=str)

    def get(self, hash: str) -> Optional[Tuple[bytes, dict]]:
        data_path = self._data_path(hash)
        meta_path = self._meta_path(hash)
        if not os.path.exists(data_path):
            return None
        with open(data_path, "rb") as f:
            data = f.read()
        metadata = {}
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        # Update accessed_at
        metadata["accessed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, default=str)
        return (data, metadata)

    def delete(self, hash: str) -> bool:
        data_path = self._data_path(hash)
        meta_path = self._meta_path(hash)
        existed = os.path.exists(data_path)
        for p in (data_path, meta_path):
            if os.path.exists(p):
                os.remove(p)
        return existed

    def contains(self, hash: str) -> bool:
        return os.path.exists(self._data_path(hash))

    def evict(self) -> int:
        """
        Evict the single least-recently-accessed entry (by meta mtime or
        accessed_at field).

        Returns 0 or 1.
        """
        entries = []
        for fname in os.listdir(self._base_dir):
            if fname.endswith(".meta"):
                hash_key = fname[:-5]  # strip .meta
                meta_path = os.path.join(self._base_dir, fname)
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    accessed = meta.get("accessed_at", "")
                    mtime = os.path.getmtime(meta_path)
                    entries.append((accessed, mtime, hash_key))
                except (json.JSONDecodeError, OSError):
                    # Corrupt meta — use mtime as fallback
                    mtime = os.path.getmtime(meta_path)
                    entries.append(("", mtime, hash_key))

        if not entries:
            return 0

        # Sort by accessed_at (string) then mtime as tiebreaker
        entries.sort(key=lambda e: (e[0], e[1]))
        oldest_hash = entries[0][2]
        self.delete(oldest_hash)
        return 1

    def clear(self) -> None:
        for fname in os.listdir(self._base_dir):
            fpath = os.path.join(self._base_dir, fname)
            if os.path.isfile(fpath):
                os.remove(fpath)

    def __len__(self) -> int:
        return sum(1 for f in os.listdir(self._base_dir) if f.endswith(".data"))

    @property
    def base_dir(self) -> str:
        return self._base_dir


# ======================================================================
# Cache Tier Manager
# ======================================================================

class CacheTierManager:
    """
    Orchestrates lookups and writes across L1 -> L2 -> L3 cache tiers.

    On a ``get`` the tiers are searched from fastest (L1) to slowest (L3).
    When a hit is found in a lower tier the caller can ``promote`` it to a
    higher tier for faster subsequent access.

    Parameters
    ----------
    l1:
        An L1Cache instance (or any object with the same interface).
    l2:
        An L2Cache instance.
    l3:
        An L3Cache instance.
    """

    def __init__(
        self,
        l1: Optional[L1Cache] = None,
        l2: Optional[L2Cache] = None,
        l3: Optional[L3Cache] = None,
    ) -> None:
        self.l1: L1Cache = l1 if l1 is not None else L1Cache()
        self.l2: L2Cache = l2 if l2 is not None else L2Cache()
        self.l3: L3Cache = l3 if l3 is not None else L3Cache()
        self._tiers = [self.l1, self.l2, self.l3]  # index 0=L1, 1=L2, 2=L3

    def put(self, hash: str, data: bytes, metadata: dict) -> None:
        """
        Write into the cache hierarchy.

        Data is written to **all** tiers so that future lookups hit L1 first.
        """
        self.l1.put(hash, data, metadata)
        self.l2.put(hash, data, metadata)
        self.l3.put(hash, data, metadata)

    def get(self, hash: str) -> Optional[Tuple[bytes, dict]]:
        """
        Search L1 -> L2 -> L3 for *hash*.

        Returns the first hit found, or ``None``.  Does **not** automatically
        promote — call ``promote`` explicitly if desired.
        """
        for tier in self._tiers:
            result = tier.get(hash)
            if result is not None:
                return result
        return None

    def promote(self, hash: str, from_tier: int, to_tier: int) -> bool:
        """
        Copy data from a lower tier to a higher tier.

        Parameters
        ----------
        hash:
            Content hash to promote.
        from_tier:
            Source tier index (0=L1, 1=L2, 2=L3).
        to_tier:
            Destination tier index.

        Returns True if the item was found in the source tier and promoted.
        """
        if from_tier < 0 or from_tier > 2 or to_tier < 0 or to_tier > 2:
            raise ValueError("Tier indices must be 0 (L1), 1 (L2), or 2 (L3)")
        if from_tier <= to_tier:
            raise ValueError("from_tier must be a lower (higher index) tier than to_tier")

        source = self._tiers[from_tier]
        dest = self._tiers[to_tier]

        result = source.get(hash)
        if result is None:
            return False

        data, metadata = result
        dest.put(hash, data, metadata)
        return True

    def get_with_tier(self, hash: str) -> Optional[Tuple[bytes, dict, int]]:
        """Like ``get`` but also returns the tier index where the hit occurred."""
        for idx, tier in enumerate(self._tiers):
            result = tier.get(hash)
            if result is not None:
                data, metadata = result
                return (data, metadata, idx)
        return None

    def delete(self, hash: str) -> bool:
        """Delete *hash* from all tiers.  Returns True if it was in any tier."""
        found = False
        for tier in self._tiers:
            if tier.delete(hash):
                found = True
        return found

    def contains(self, hash: str) -> bool:
        for tier in self._tiers:
            if tier.contains(hash):
                return True
        return False

    def flush_all(self) -> None:
        """Clear all cache tiers."""
        self.l1.clear()
        self.l2.clear()
        self.l3.clear()
