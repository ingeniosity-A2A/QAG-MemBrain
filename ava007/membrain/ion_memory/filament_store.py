"""
filament_store.py — SQLite / LMDB / RocksDB Backend for Filament Persistence

Provides an abstract ``FilamentStoreBase`` with a concrete SQLite implementation
(``FilamentStore``).  Optional LMDB and RocksDB backends are detected at
import time and raise ``ImportError`` with a helpful message if unavailable.

Table schema (SQLite):
    CREATE TABLE IF NOT EXISTS filaments (
        key        TEXT PRIMARY KEY,
        level      INTEGER NOT NULL,
        write_count INTEGER DEFAULT 1,
        updated_at TEXT
    );
"""

from __future__ import annotations

import abc
import json
import sqlite3
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .mlc_emulation import MLCEmulation


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class FilamentStoreBase(abc.ABC):
    """Abstract interface for a filament key-level store."""

    @abc.abstractmethod
    def put(self, key: str, level: int) -> None:
        """Write *level* for *key*, creating or updating the entry."""

    @abc.abstractmethod
    def get(self, key: str) -> Optional[int]:
        """Return the conductance level for *key*, or *None* if absent."""

    @abc.abstractmethod
    def delete(self, key: str) -> bool:
        """Delete *key*.  Return *True* if the key existed and was removed."""

    @abc.abstractmethod
    def keys(self) -> List[str]:
        """Return all filament keys."""

    @abc.abstractmethod
    def count(self) -> int:
        """Return the number of stored filaments."""

    @abc.abstractmethod
    def get_write_count(self, key: str) -> int:
        """Return the cumulative write count for *key* (0 if absent)."""

    @abc.abstractmethod
    def items(self) -> List[Tuple[str, int]]:
        """Return all (key, level) pairs."""


# ---------------------------------------------------------------------------
# SQLite backend
# ---------------------------------------------------------------------------

class FilamentStore(FilamentStoreBase):
    """SQLite-backed persistent filament store.

    Parameters
    ----------
    path : str | Path | None
        Path to the SQLite database file.  When *None* a temporary file is
        created via ``tempfile.mkstemp``.
    mlc : MLCEmulation | None
        MLC emulator used for level validation on writes.  A default
        instance is created when *None*.
    """

    _SCHEMA = """
    CREATE TABLE IF NOT EXISTS filaments (
        key        TEXT PRIMARY KEY,
        level      INTEGER NOT NULL,
        write_count INTEGER DEFAULT 1,
        updated_at TEXT
    );
    """

    def __init__(
        self,
        path: str | Path | None = None,
        mlc: MLCEmulation | None = None,
    ) -> None:
        self._mlc = mlc or MLCEmulation()
        if path is None:
            fd, tmp = tempfile.mkstemp(suffix=".db", prefix="ion_mem_")
            self._path = Path(tmp)
            # Close the raw fd — sqlite3 will open its own handle
            import os
            os.close(fd)
        else:
            self._path = Path(path)
            self._path.parent.mkdir(parents=True, exist_ok=True)

        self._conn = sqlite3.connect(str(self._path))
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.executescript(self._SCHEMA)
        self._conn.commit()

    # ----- helpers -----

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    # ----- public API -----

    def put(self, key: str, level: int) -> None:
        """Insert or update a filament.

        If *key* already exists the level is updated and the write_count is
        incremented; otherwise a new row is inserted with write_count = 1.
        """
        if not self._mlc.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")

        now = self._now_iso()
        # Upsert: increment write_count on conflict
        self._conn.execute(
            """
            INSERT INTO filaments (key, level, write_count, updated_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET
                level      = excluded.level,
                write_count = write_count + 1,
                updated_at  = excluded.updated_at
            """,
            (key, level, now),
        )
        self._conn.commit()

    def get(self, key: str) -> Optional[int]:
        cur = self._conn.execute("SELECT level FROM filaments WHERE key = ?", (key,))
        row = cur.fetchone()
        return row[0] if row else None

    def delete(self, key: str) -> bool:
        cur = self._conn.execute("DELETE FROM filaments WHERE key = ?", (key,))
        self._conn.commit()
        return cur.rowcount > 0

    def keys(self) -> List[str]:
        cur = self._conn.execute("SELECT key FROM filaments ORDER BY key")
        return [row[0] for row in cur.fetchall()]

    def count(self) -> int:
        cur = self._conn.execute("SELECT COUNT(*) FROM filaments")
        return cur.fetchone()[0]

    def get_write_count(self, key: str) -> int:
        cur = self._conn.execute(
            "SELECT write_count FROM filaments WHERE key = ?", (key,)
        )
        row = cur.fetchone()
        return row[0] if row else 0

    def items(self) -> List[Tuple[str, int]]:
        cur = self._conn.execute("SELECT key, level FROM filaments ORDER BY key")
        return [(row[0], row[1]) for row in cur.fetchall()]

    # ----- bulk / snapshot helpers -----

    def get_all_as_dict(self) -> Dict[str, int]:
        """Return the full store as a ``{key: level}`` dict."""
        return dict(self.items())

    def bulk_put(self, data: Dict[str, int]) -> int:
        """Write multiple filaments at once.  Returns number of rows affected."""
        now = self._now_iso()
        rows = []
        for key, level in data.items():
            if not self._mlc.validate_level(level):
                raise ValueError(f"Invalid MLC level {level!r} for key {key!r}.")
            rows.append((key, level, now))

        count = 0
        for key, level, ts in rows:
            self._conn.execute(
                """
                INSERT INTO filaments (key, level, write_count, updated_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(key) DO UPDATE SET
                    level      = excluded.level,
                    write_count = write_count + 1,
                    updated_at  = excluded.updated_at
                """,
                (key, level, ts),
            )
            count += 1
        self._conn.commit()
        return count

    def clear(self) -> int:
        """Delete all filaments.  Returns count of deleted rows."""
        cur = self._conn.execute("SELECT COUNT(*) FROM filaments")
        n = cur.fetchone()[0]
        self._conn.execute("DELETE FROM filaments")
        self._conn.commit()
        return n

    # ----- lifecycle -----

    def close(self) -> None:
        """Close the underlying SQLite connection."""
        if self._conn:
            self._conn.close()
            self._conn = None  # type: ignore[assignment]

    @property
    def path(self) -> Path:
        return self._path

    def __repr__(self) -> str:
        return f"FilamentStore(path={self._path!s}, count={self.count()})"


# ---------------------------------------------------------------------------
# Optional LMDB backend
# ---------------------------------------------------------------------------

class LMDBFilamentStore(FilamentStoreBase):
    """LMDB-backed filament store.

    Requires the ``lmdb`` package.  Raises ``ImportError`` at instantiation
    if it is not available, with instructions for installation.
    """

    def __init__(self, path: str | Path, map_size: int = 10 * 1024 * 1024) -> None:
        try:
            import lmdb  # noqa: F401 — we need it for real
        except ImportError as exc:
            raise ImportError(
                "LMDB backend requires the 'lmdb' package. "
                "Install with:  pip install lmdb"
            ) from exc

        self._path = Path(path)
        self._path.mkdir(parents=True, exist_ok=True)
        self._mlc = MLCEmulation()
        self._env = lmdb.open(str(self._path), map_size=map_size)
        # We store JSON-encoded records: {"level": int, "write_count": int, "updated_at": str}
        with self._env.begin(write=True) as txn:
            pass  # ensure DB is created

    def _encode(self, level: int, write_count: int, updated_at: str) -> bytes:
        return json.dumps({
            "level": level,
            "write_count": write_count,
            "updated_at": updated_at,
        }).encode("utf-8")

    def _decode(self, raw: bytes) -> Dict:
        return json.loads(raw.decode("utf-8"))

    def put(self, key: str, level: int) -> None:
        if not self._mlc.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")
        now = datetime.now(timezone.utc).isoformat()
        with self._env.begin(write=True) as txn:
            existing = txn.get(key.encode("utf-8"))
            if existing is not None:
                rec = self._decode(existing)
                wc = rec["write_count"] + 1
            else:
                wc = 1
            txn.put(
                key.encode("utf-8"),
                self._encode(level, wc, now),
            )

    def get(self, key: str) -> Optional[int]:
        with self._env.begin(write=False) as txn:
            raw = txn.get(key.encode("utf-8"))
        if raw is None:
            return None
        return self._decode(raw)["level"]

    def delete(self, key: str) -> bool:
        with self._env.begin(write=True) as txn:
            return txn.delete(key.encode("utf-8"))

    def keys(self) -> List[str]:
        result: List[str] = []
        with self._env.begin(write=False) as txn:
            cursor = txn.cursor()
            for key_bytes, _ in cursor:
                result.append(key_bytes.decode("utf-8"))
        return result

    def count(self) -> int:
        with self._env.begin(write=False) as txn:
            return txn.stat()["entries"]

    def get_write_count(self, key: str) -> int:
        with self._env.begin(write=False) as txn:
            raw = txn.get(key.encode("utf-8"))
        if raw is None:
            return 0
        return self._decode(raw)["write_count"]

    def items(self) -> List[Tuple[str, int]]:
        result: List[Tuple[str, int]] = []
        with self._env.begin(write=False) as txn:
            cursor = txn.cursor()
            for key_bytes, val_bytes in cursor:
                rec = self._decode(val_bytes)
                result.append((key_bytes.decode("utf-8"), rec["level"]))
        return result

    def close(self) -> None:
        if self._env:
            self._env.close()

    def __repr__(self) -> str:
        return f"LMDBFilamentStore(path={self._path!s})"


# ---------------------------------------------------------------------------
# Optional RocksDB backend
# ---------------------------------------------------------------------------

class RocksDBFilamentStore(FilamentStoreBase):
    """RocksDB-backed filament store.

    Requires the ``python-rocksdb`` package.  Raises ``ImportError`` at
    instantiation if unavailable.
    """

    def __init__(self, path: str | Path) -> None:
        try:
            import rocksdb  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "RocksDB backend requires the 'python-rocksdb' package. "
                "Install with:  pip install python-rocksdb"
            ) from exc

        self._path = Path(path)
        self._path.mkdir(parents=True, exist_ok=True)
        self._mlc = MLCEmulation()
        opts = rocksdb.Options()
        opts.create_if_missing = True
        self._db = rocksdb.DB(str(self._path), opts)

    def _encode(self, level: int, write_count: int, updated_at: str) -> bytes:
        return json.dumps({
            "level": level,
            "write_count": write_count,
            "updated_at": updated_at,
        }).encode("utf-8")

    def _decode(self, raw: bytes) -> Dict:
        return json.loads(raw.decode("utf-8"))

    def put(self, key: str, level: int) -> None:
        if not self._mlc.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")
        now = datetime.now(timezone.utc).isoformat()
        raw = self._db.get(key.encode("utf-8"))
        if raw is not None:
            rec = self._decode(raw)
            wc = rec["write_count"] + 1
        else:
            wc = 1
        self._db.put(key.encode("utf-8"), self._encode(level, wc, now))

    def get(self, key: str) -> Optional[int]:
        raw = self._db.get(key.encode("utf-8"))
        if raw is None:
            return None
        return self._decode(raw)["level"]

    def delete(self, key: str) -> bool:
        raw = self._db.get(key.encode("utf-8"))
        if raw is None:
            return False
        self._db.delete(key.encode("utf-8"))
        return True

    def keys(self) -> List[str]:
        result: List[str] = []
        it = self._db.iteritems()
        it.seek_to_first()
        for key_bytes, _ in it:
            result.append(key_bytes.decode("utf-8"))
        return result

    def count(self) -> int:
        return len(self.keys())

    def get_write_count(self, key: str) -> int:
        raw = self._db.get(key.encode("utf-8"))
        if raw is None:
            return 0
        return self._decode(raw)["write_count"]

    def items(self) -> List[Tuple[str, int]]:
        result: List[Tuple[str, int]] = []
        it = self._db.iteritems()
        it.seek_to_first()
        for key_bytes, val_bytes in it:
            rec = self._decode(val_bytes)
            result.append((key_bytes.decode("utf-8"), rec["level"]))
        return result

    def close(self) -> None:
        # python-rocksdb doesn't expose an explicit close; rely on GC
        pass

    def __repr__(self) -> str:
        return f"RocksDBFilamentStore(path={self._path!s})"
