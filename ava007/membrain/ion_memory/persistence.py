"""
persistence.py — Multi-Tier Persistence Manager for Ion Memory

Implements a three-tier storage hierarchy inspired by CPU cache levels:

    L1 (InMemoryDict)  — Fastest, volatile.  Pure Python dict.
    L2 (SQLite / LMDB) — Durable, moderate speed.  Default: sqlite3.
    L3 (FASt Mesh)     — Cold / distributed storage.  Lazy import.

Data can be promoted (slower → faster) or demoted (faster → slower)
between tiers.  ``flush()`` pushes all L1 data to L2 for durability.

All tiers store arbitrary picklable Python values (not just MLC levels)
because the persistence layer is used by higher cognitive layers as well.
"""

from __future__ import annotations

import abc
import json
import logging
import pickle
import sqlite3
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tier enum
# ---------------------------------------------------------------------------

class Tier(Enum):
    """Persistence tier identifiers."""
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


# ---------------------------------------------------------------------------
# Tier record
# ---------------------------------------------------------------------------

@dataclass
class TierRecord:
    """A single entry stored in a persistence tier."""
    key: str
    value: Any
    stored_at: float = field(default_factory=time.time)
    tier: Tier = Tier.L1


# ---------------------------------------------------------------------------
# Abstract tier interface
# ---------------------------------------------------------------------------

class TierBase(abc.ABC):
    """Abstract base for a single persistence tier."""

    @abc.abstractmethod
    def put(self, key: str, value: Any) -> None:
        """Store *value* under *key*."""

    @abc.abstractmethod
    def get(self, key: str) -> Optional[Any]:
        """Retrieve value for *key*, or *None* if absent."""

    @abc.abstractmethod
    def delete(self, key: str) -> bool:
        """Remove *key*.  Return *True* if it existed."""

    @abc.abstractmethod
    def keys(self) -> List[str]:
        """Return all keys in this tier."""

    @abc.abstractmethod
    def count(self) -> int:
        """Return the number of entries."""

    @abc.abstractmethod
    def contains(self, key: str) -> bool:
        """Return *True* if *key* exists."""

    def items(self) -> List[Tuple[str, Any]]:
        """Return all (key, value) pairs.  Default iterates keys + gets."""
        result: List[Tuple[str, Any]] = []
        for k in self.keys():
            v = self.get(k)
            if v is not None:
                result.append((k, v))
        return result


# ---------------------------------------------------------------------------
# L1 — In-memory dict tier
# ---------------------------------------------------------------------------

class L1Tier(TierBase):
    """Volatile in-memory storage backed by a plain Python dict.

    This is the fastest tier and is used for hot data that must be
    accessed with minimal latency.  Data is lost on process exit unless
    flushed to L2.
    """

    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}

    def put(self, key: str, value: Any) -> None:
        self._data[key] = value

    def get(self, key: str) -> Optional[Any]:
        return self._data.get(key)

    def delete(self, key: str) -> bool:
        if key in self._data:
            del self._data[key]
            return True
        return False

    def keys(self) -> List[str]:
        return list(self._data.keys())

    def count(self) -> int:
        return len(self._data)

    def contains(self, key: str) -> bool:
        return key in self._data

    def items(self) -> List[Tuple[str, Any]]:
        return list(self._data.items())

    def clear(self) -> int:
        """Remove all entries and return the count of removed items."""
        n = len(self._data)
        self._data.clear()
        return n

    def __repr__(self) -> str:
        return f"L1Tier(entries={self.count()})"


# ---------------------------------------------------------------------------
# L2 — SQLite-backed durable tier
# ---------------------------------------------------------------------------

class L2Tier(TierBase):
    """Durable storage backed by SQLite (default) or LMDB.

    Values are serialised with ``pickle`` so that arbitrary Python objects
    can be stored.  The SQLite schema uses a single table with BLOB values.

    Parameters
    ----------
    path : str | Path | None
        Database path.  *None* creates a temporary file.
    backend : str
        ``"sqlite"`` (default) or ``"lmdb"``.  LMDB requires the ``lmdb``
        package; an ``ImportError`` is raised if it is not installed.
    """

    _SCHEMA = """
    CREATE TABLE IF NOT EXISTS persistence (
        key       TEXT PRIMARY KEY,
        value     BLOB NOT NULL,
        stored_at REAL
    );
    """

    def __init__(
        self,
        path: str | Path | None = None,
        backend: str = "sqlite",
    ) -> None:
        if backend == "lmdb":
            self._init_lmdb(path)
        else:
            self._init_sqlite(path)
        self._backend = backend

    def _init_sqlite(self, path: str | Path | None) -> None:
        if path is None:
            fd, tmp = tempfile.mkstemp(suffix=".db", prefix="ion_l2_")
            self._path = Path(tmp)
            import os
            os.close(fd)
        else:
            self._path = Path(path)
            self._path.parent.mkdir(parents=True, exist_ok=True)

        self._conn = sqlite3.connect(str(self._path))
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.executescript(self._SCHEMA)
        self._conn.commit()
        self._lmdb_env = None  # type: ignore[assignment]

    def _init_lmdb(self, path: str | Path | None) -> None:
        try:
            import lmdb
        except ImportError as exc:
            raise ImportError(
                "LMDB L2 backend requires the 'lmdb' package. "
                "Install with:  pip install lmdb"
            ) from exc
        if path is None:
            tmp = tempfile.mkdtemp(prefix="ion_l2_")
            self._path = Path(tmp)
        else:
            self._path = Path(path)
        self._path.mkdir(parents=True, exist_ok=True)
        self._lmdb_env = lmdb.open(str(self._path), map_size=50 * 1024 * 1024)
        self._conn = None  # type: ignore[assignment]

    # ---- SQLite implementation ----

    def put(self, key: str, value: Any) -> None:
        blob = pickle.dumps(value)
        now = time.time()
        if self._backend == "lmdb" and self._lmdb_env is not None:
            self._put_lmdb(key, blob, now)
        else:
            self._conn.execute(
                """
                INSERT INTO persistence (key, value, stored_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    stored_at = excluded.stored_at
                """,
                (key, blob, now),
            )
            self._conn.commit()

    def _put_lmdb(self, key: str, blob: bytes, stored_at: float) -> None:
        record = json.dumps({"blob": list(blob), "stored_at": stored_at}).encode("utf-8")
        with self._lmdb_env.begin(write=True) as txn:
            txn.put(key.encode("utf-8"), record)

    def get(self, key: str) -> Optional[Any]:
        if self._backend == "lmdb" and self._lmdb_env is not None:
            return self._get_lmdb(key)
        cur = self._conn.execute("SELECT value FROM persistence WHERE key = ?", (key,))
        row = cur.fetchone()
        if row is None:
            return None
        return pickle.loads(row[0])

    def _get_lmdb(self, key: str) -> Optional[Any]:
        with self._lmdb_env.begin(write=False) as txn:
            raw = txn.get(key.encode("utf-8"))
        if raw is None:
            return None
        rec = json.loads(raw.decode("utf-8"))
        return pickle.loads(bytes(rec["blob"]))

    def delete(self, key: str) -> bool:
        if self._backend == "lmdb" and self._lmdb_env is not None:
            with self._lmdb_env.begin(write=True) as txn:
                return txn.delete(key.encode("utf-8"))
        cur = self._conn.execute("DELETE FROM persistence WHERE key = ?", (key,))
        self._conn.commit()
        return cur.rowcount > 0

    def keys(self) -> List[str]:
        if self._backend == "lmdb" and self._lmdb_env is not None:
            result: List[str] = []
            with self._lmdb_env.begin(write=False) as txn:
                cursor = txn.cursor()
                for k, _ in cursor:
                    result.append(k.decode("utf-8"))
            return result
        cur = self._conn.execute("SELECT key FROM persistence ORDER BY key")
        return [row[0] for row in cur.fetchall()]

    def count(self) -> int:
        if self._backend == "lmdb" and self._lmdb_env is not None:
            with self._lmdb_env.begin(write=False) as txn:
                return txn.stat()["entries"]
        cur = self._conn.execute("SELECT COUNT(*) FROM persistence")
        return cur.fetchone()[0]

    def contains(self, key: str) -> bool:
        if self._backend == "lmdb" and self._lmdb_env is not None:
            with self._lmdb_env.begin(write=False) as txn:
                return txn.get(key.encode("utf-8")) is not None
        cur = self._conn.execute(
            "SELECT 1 FROM persistence WHERE key = ? LIMIT 1", (key,)
        )
        return cur.fetchone() is not None

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None  # type: ignore[assignment]
        if self._lmdb_env is not None:
            self._lmdb_env.close()
            self._lmdb_env = None  # type: ignore[assignment]

    def __repr__(self) -> str:
        return f"L2Tier(backend={self._backend!r}, entries={self.count()})"


# ---------------------------------------------------------------------------
# L3 — Cold / FASt Mesh tier
# ---------------------------------------------------------------------------

class L3Tier(TierBase):
    """Cold storage tier backed by a FASt Mesh or local JSON fallback.

    When the ``fast_mesh`` package is available, data is stored on the
    distributed FASt Mesh.  Otherwise a simple local JSON file is used as
    a fallback so that the persistence layer remains functional in
    development / testing.

    Parameters
    ----------
    path : str | Path | None
        Path for the local JSON fallback store.
    """

    def __init__(self, path: str | Path | None = None) -> None:
        self._mesh_client: Any = None
        self._mesh_available: bool = False

        # Try to import fast_mesh
        try:
            from ava007.membrain import fast_mesh  # type: ignore[import-not-found]
            self._mesh_client = fast_mesh.FAStMeshClient()
            self._mesh_available = True
            logger.info("L3 tier: FASt Mesh client initialised.")
        except (ImportError, AttributeError):
            logger.info(
                "L3 tier: fast_mesh not available — using local JSON fallback."
            )

        if path is None:
            fd, tmp = tempfile.mkstemp(suffix=".json", prefix="ion_l3_")
            self._path = Path(tmp)
            import os
            os.close(fd)
        else:
            self._path = Path(path)
            self._path.parent.mkdir(parents=True, exist_ok=True)

        self._data: Dict[str, Any] = self._load_json()

    def _load_json(self) -> Dict[str, Any]:
        """Load the JSON fallback file if it exists."""
        if self._path.exists() and self._path.stat().st_size > 0:
            try:
                with open(self._path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save_json(self) -> None:
        """Persist the local dict to the JSON fallback file."""
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)

    def put(self, key: str, value: Any) -> None:
        if self._mesh_available and self._mesh_client is not None:
            try:
                self._mesh_client.put(key, pickle.dumps(value))
                return
            except Exception:
                logger.warning(
                    "FASt Mesh put failed for %r — falling back to JSON.", key
                )
        # JSON fallback — we need JSON-serialisable values
        self._data[key] = value
        self._save_json()

    def get(self, key: str) -> Optional[Any]:
        if self._mesh_available and self._mesh_client is not None:
            try:
                raw = self._mesh_client.get(key)
                return pickle.loads(raw) if raw is not None else None
            except Exception:
                logger.warning(
                    "FASt Mesh get failed for %r — falling back to JSON.", key
                )
        return self._data.get(key)

    def delete(self, key: str) -> bool:
        if self._mesh_available and self._mesh_client is not None:
            try:
                return self._mesh_client.delete(key)
            except Exception:
                logger.warning(
                    "FASt Mesh delete failed for %r — falling back to JSON.", key
                )
        if key in self._data:
            del self._data[key]
            self._save_json()
            return True
        return False

    def keys(self) -> List[str]:
        if self._mesh_available and self._mesh_client is not None:
            try:
                return self._mesh_client.keys()
            except Exception:
                pass
        return list(self._data.keys())

    def count(self) -> int:
        return len(self.keys())

    def contains(self, key: str) -> bool:
        if self._mesh_available and self._mesh_client is not None:
            try:
                return self._mesh_client.contains(key)
            except Exception:
                pass
        return key in self._data

    def close(self) -> None:
        self._save_json()

    def __repr__(self) -> str:
        mode = "fast_mesh" if self._mesh_available else "json_fallback"
        return f"L3Tier(mode={mode!r}, entries={self.count()})"


# ---------------------------------------------------------------------------
# PersistenceManager — orchestrates the three tiers
# ---------------------------------------------------------------------------

class PersistenceManager:
    """Multi-tier persistence manager for ion memory and higher cognitive layers.

    Data can be stored at a specific tier and promoted / demoted between
    tiers.  ``flush()`` pushes all L1 data into L2 for crash safety.

    Parameters
    ----------
    l2_path : str | Path | None
        Path for the L2 SQLite database.  *None* → temp file.
    l2_backend : str
        ``"sqlite"`` or ``"lmdb"`` for the L2 tier.
    l3_path : str | Path | None
        Path for the L3 JSON fallback.  *None* → temp file.
    """

    def __init__(
        self,
        l2_path: str | Path | None = None,
        l2_backend: str = "sqlite",
        l3_path: str | Path | None = None,
    ) -> None:
        self._l1 = L1Tier()
        self._l2 = L2Tier(path=l2_path, backend=l2_backend)
        self._l3 = L3Tier(path=l3_path)
        self._tiers: Dict[Tier, TierBase] = {
            Tier.L1: self._l1,
            Tier.L2: self._l2,
            Tier.L3: self._l3,
        }

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def put(self, key: str, value: Any, tier: str = "L1") -> None:
        """Store *value* at the specified *tier*.

        Parameters
        ----------
        key : str
            Lookup key.
        value : Any
            Any picklable / JSON-serialisable value.
        tier : str
            ``"L1"``, ``"L2"``, or ``"L3"`` (case-sensitive).
        """
        t = self._resolve_tier(tier)
        self._tiers[t].put(key, value)

    def get(self, key: str, tier: str = "L1") -> Optional[Any]:
        """Retrieve *value* from the specified *tier*.

        Does **not** search other tiers — use ``get_any`` for that.
        """
        t = self._resolve_tier(tier)
        return self._tiers[t].get(key)

    def get_any(self, key: str) -> Optional[Tuple[Any, Tier]]:
        """Search L1 → L2 → L3 for *key*.

        Returns
        -------
        (value, tier) | None
            The value and the tier where it was found, or *None*.
        """
        for t in (Tier.L1, Tier.L2, Tier.L3):
            val = self._tiers[t].get(key)
            if val is not None:
                return (val, t)
        return None

    def delete(self, key: str, tier: str = "L1") -> bool:
        """Delete *key* from the specified *tier* only."""
        t = self._resolve_tier(tier)
        return self._tiers[t].delete(key)

    def delete_all(self, key: str) -> int:
        """Delete *key* from **all** tiers.  Returns number of tiers affected."""
        deleted = 0
        for tier in (Tier.L1, Tier.L2, Tier.L3):
            if self._tiers[tier].delete(key):
                deleted += 1
        return deleted

    # ------------------------------------------------------------------
    # Promotion / demotion
    # ------------------------------------------------------------------

    def promote(self, key: str, from_tier: str, to_tier: str) -> bool:
        """Copy *key* from a slower tier to a faster tier.

        The data is **copied**, not moved (the source entry is retained).

        Returns
        -------
        bool
            *True* if the key existed in *from_tier* and was promoted.
        """
        src = self._resolve_tier(from_tier)
        dst = self._resolve_tier(to_tier)
        val = self._tiers[src].get(key)
        if val is None:
            return False
        self._tiers[dst].put(key, val)
        logger.debug("Promoted %r from %s → %s", key, src.name, dst.name)
        return True

    def demote(self, key: str, from_tier: str, to_tier: str) -> bool:
        """Copy *key* from a faster tier to a slower tier.

        This is the inverse of ``promote`` — useful for freeing L1 space
        while keeping data accessible at L2/L3.

        Returns
        -------
        bool
            *True* if the key existed in *from_tier* and was demoted.
        """
        # Semantically identical to promote but the direction is slower
        return self.promote(key, from_tier, to_tier)

    # ------------------------------------------------------------------
    # Flush
    # ------------------------------------------------------------------

    def flush(self) -> int:
        """Flush all L1 entries to L2 for durability.

        Returns
        -------
        int
            Number of entries flushed.
        """
        count = 0
        for key, value in self._l1.items():
            self._l2.put(key, value)
            count += 1
        logger.debug("Flushed %d entries from L1 → L2.", count)
        return count

    # ------------------------------------------------------------------
    # Tier access
    # ------------------------------------------------------------------

    @property
    def l1(self) -> L1Tier:
        return self._l1

    @property
    def l2(self) -> L2Tier:
        return self._l2

    @property
    def l3(self) -> L3Tier:
        return self._l3

    def tier_stats(self) -> Dict[str, int]:
        """Return ``{tier_name: entry_count}`` for all tiers."""
        return {
            "L1": self._l1.count(),
            "L2": self._l2.count(),
            "L3": self._l3.count(),
        }

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Flush and close all tiers."""
        self.flush()
        self._l2.close()
        self._l3.close()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_tier(tier: str) -> Tier:
        mapping = {"L1": Tier.L1, "L2": Tier.L2, "L3": Tier.L3}
        t = mapping.get(tier)
        if t is None:
            raise ValueError(f"Invalid tier {tier!r}; must be L1, L2, or L3.")
        return t

    def __repr__(self) -> str:
        stats = self.tier_stats()
        return (
            f"PersistenceManager(L1={stats['L1']}, L2={stats['L2']}, "
            f"L3={stats['L3']})"
        )
