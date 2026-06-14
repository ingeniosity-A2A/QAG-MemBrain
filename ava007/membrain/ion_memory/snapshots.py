"""
snapshots.py — Content-Addressable Epoch Snapshots for Ion Memory

Provides ``SnapshotManager`` which creates cryptographic (SHA-256) snapshots
of the complete filament state.  Snapshots are content-addressable: the
snapshot ID is derived from the hash of the serialised data, ensuring that
identical states produce identical IDs and any tampering is detectable.

Snapshot records contain metadata (label, creation time, filament count,
byte size) and the actual data is stored as a JSON blob keyed by its hash.

Typical usage::

    from ava007.membrain.ion_memory.snapshots import SnapshotManager
    from ava007.membrain.ion_memory.filament_store import FilamentStore

    store = FilamentStore()
    store.put("a", 3)
    store.put("b", 5)

    mgr = SnapshotManager()
    rec = mgr.create_snapshot(store, label="epoch_0")
    assert mgr.verify_snapshot(rec.id)

    mgr.restore_snapshot(rec.id, store)
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .filament_store import FilamentStoreBase


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SnapshotRecord:
    """Immutable metadata for a single snapshot."""
    id: str                              # SHA-256 hex digest of the snapshot data
    hash: str                            # Same as id (canonical content hash)
    label: str                           # Human-readable label
    created_at: str                      # ISO-8601 UTC timestamp
    filament_count: int                  # Number of filaments in the snapshot
    size_bytes: int                      # Size of the serialised JSON blob


# ---------------------------------------------------------------------------
# SnapshotManager
# ---------------------------------------------------------------------------

class SnapshotManager:
    """Content-addressable snapshot manager for filament stores.

    Snapshots are stored as JSON blobs in a local SQLite database keyed by
    their SHA-256 content hash.  This makes them:
      * **Content-addressable** — identical data → same hash → de-duped.
      * **Verifiable** — re-computing the hash detects corruption / tampering.
      * **Restorable** — the full filament state can be reloaded.

    Parameters
    ----------
    db_path : str | Path | None
        Path to the SQLite snapshot database.  *None* creates a temp file.
    """

    _SCHEMA = """
    CREATE TABLE IF NOT EXISTS snapshot_meta (
        id              TEXT PRIMARY KEY,
        hash            TEXT NOT NULL,
        label           TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        filament_count  INTEGER NOT NULL,
        size_bytes      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshot_data (
        hash  TEXT PRIMARY KEY,
        data  TEXT NOT NULL
    );
    """

    def __init__(self, db_path: str | Path | None = None) -> None:
        if db_path is None:
            fd, tmp = tempfile.mkstemp(suffix=".db", prefix="ion_snap_")
            self._path = Path(tmp)
            os.close(fd)
        else:
            self._path = Path(db_path)
            self._path.parent.mkdir(parents=True, exist_ok=True)

        self._conn = sqlite3.connect(str(self._path))
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.executescript(self._SCHEMA)
        self._conn.commit()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _serialise(filament_dict: Dict[str, int]) -> bytes:
        """Deterministically serialise a ``{key: level}`` dict.

        Keys are sorted so that the serialisation is order-independent,
        producing a stable hash for the same logical content.
        """
        ordered = {k: filament_dict[k] for k in sorted(filament_dict)}
        return json.dumps(ordered, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @staticmethod
    def _compute_hash(data: bytes) -> str:
        """Return the SHA-256 hex digest of *data*."""
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _meta_from_row(self, row: tuple) -> SnapshotRecord:
        return SnapshotRecord(
            id=row[0],
            hash=row[1],
            label=row[2],
            created_at=row[3],
            filament_count=row[4],
            size_bytes=row[5],
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_snapshot(
        self,
        store: FilamentStoreBase,
        label: str,
    ) -> SnapshotRecord:
        """Create a content-addressable snapshot of the current store state.

        Parameters
        ----------
        store : FilamentStoreBase
            The filament store to snapshot.
        label : str
            A human-readable label for this epoch (e.g. ``"epoch_42"``).

        Returns
        -------
        SnapshotRecord
            Metadata record for the newly created snapshot.
        """
        # 1. Extract the full state
        filament_dict = dict(store.items())  # {key: level}

        # 2. Deterministic serialisation
        data_bytes = self._serialise(filament_dict)
        content_hash = self._compute_hash(data_bytes)
        size_bytes = len(data_bytes)

        # 3. Check for duplicate (content-addressable → idempotent)
        existing = self._conn.execute(
            "SELECT id FROM snapshot_meta WHERE hash = ?",
            (content_hash,),
        ).fetchone()
        if existing is not None:
            # Snapshot with identical content already exists — return it
            return self.get_snapshot(existing[0])  # type: ignore[return-value]

        # 4. Store the data blob
        self._conn.execute(
            "INSERT OR IGNORE INTO snapshot_data (hash, data) VALUES (?, ?)",
            (content_hash, data_bytes.decode("utf-8")),
        )

        # 5. Store the metadata record
        now = self._now_iso()
        snapshot_id = content_hash  # Content-addressable: ID = hash
        record = SnapshotRecord(
            id=snapshot_id,
            hash=content_hash,
            label=label,
            created_at=now,
            filament_count=len(filament_dict),
            size_bytes=size_bytes,
        )

        self._conn.execute(
            """
            INSERT INTO snapshot_meta
                (id, hash, label, created_at, filament_count, size_bytes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (record.id, record.hash, record.label,
             record.created_at, record.filament_count, record.size_bytes),
        )
        self._conn.commit()

        return record

    def restore_snapshot(
        self,
        snapshot_id: str,
        store: FilamentStoreBase,
    ) -> None:
        """Restore the filament store to the state captured in a snapshot.

        This **clears** the target store before loading the snapshot data.

        Parameters
        ----------
        snapshot_id : str
            The snapshot ID (SHA-256 hash).
        store : FilamentStoreBase
            The filament store to restore into.

        Raises
        ------
        KeyError
            If *snapshot_id* does not exist.
        """
        # 1. Retrieve metadata
        meta_row = self._conn.execute(
            "SELECT id, hash, label, created_at, filament_count, size_bytes "
            "FROM snapshot_meta WHERE id = ?",
            (snapshot_id,),
        ).fetchone()
        if meta_row is None:
            raise KeyError(f"Snapshot {snapshot_id!r} not found.")

        record = self._meta_from_row(meta_row)

        # 2. Retrieve the data blob
        data_row = self._conn.execute(
            "SELECT data FROM snapshot_data WHERE hash = ?",
            (record.hash,),
        ).fetchone()
        if data_row is None:
            raise RuntimeError(
                f"Snapshot data for hash {record.hash!r} is missing."
            )

        # 3. Deserialise
        filament_dict: Dict[str, int] = json.loads(data_row[0])

        # 4. Clear target store
        if hasattr(store, "clear"):
            store.clear()  # type: ignore[attr-defined]
        else:
            # Fallback: delete keys one by one
            for key in store.keys():
                store.delete(key)

        # 5. Bulk load
        if hasattr(store, "bulk_put"):
            store.bulk_put(filament_dict)  # type: ignore[attr-defined]
        else:
            for key, level in filament_dict.items():
                store.put(key, level)

    def get_snapshot(self, snapshot_id: str) -> Optional[SnapshotRecord]:
        """Retrieve snapshot metadata by ID.

        Returns
        -------
        SnapshotRecord | None
            The record, or *None* if not found.
        """
        row = self._conn.execute(
            "SELECT id, hash, label, created_at, filament_count, size_bytes "
            "FROM snapshot_meta WHERE id = ?",
            (snapshot_id,),
        ).fetchone()
        if row is None:
            return None
        return self._meta_from_row(row)

    def list_snapshots(self) -> List[SnapshotRecord]:
        """Return all snapshot records, ordered by creation time."""
        cur = self._conn.execute(
            "SELECT id, hash, label, created_at, filament_count, size_bytes "
            "FROM snapshot_meta ORDER BY created_at"
        )
        return [self._meta_from_row(row) for row in cur.fetchall()]

    def verify_snapshot(self, snapshot_id: str) -> bool:
        """Verify a snapshot by re-computing its content hash.

        Returns
        -------
        bool
            *True* if the stored data's SHA-256 matches the recorded hash.
            *False* if the snapshot doesn't exist or the hash mismatches
            (indicating corruption).
        """
        record = self.get_snapshot(snapshot_id)
        if record is None:
            return False

        data_row = self._conn.execute(
            "SELECT data FROM snapshot_data WHERE hash = ?",
            (record.hash,),
        ).fetchone()
        if data_row is None:
            return False

        data_bytes = data_row[0].encode("utf-8")
        recomputed_hash = self._compute_hash(data_bytes)
        return recomputed_hash == record.hash

    def delete_snapshot(self, snapshot_id: str) -> bool:
        """Delete a snapshot and its data blob.

        Returns
        -------
        bool
            *True* if the snapshot existed and was removed.
        """
        record = self.get_snapshot(snapshot_id)
        if record is None:
            return False

        # Delete metadata
        self._conn.execute(
            "DELETE FROM snapshot_meta WHERE id = ?", (snapshot_id,)
        )
        # Delete data blob (only if no other snapshots reference the same hash)
        other_refs = self._conn.execute(
            "SELECT COUNT(*) FROM snapshot_meta WHERE hash = ? AND id != ?",
            (record.hash, snapshot_id),
        ).fetchone()[0]
        if other_refs == 0:
            self._conn.execute(
                "DELETE FROM snapshot_data WHERE hash = ?", (record.hash,)
            )
        self._conn.commit()
        return True

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying SQLite connection."""
        if self._conn:
            self._conn.close()
            self._conn = None  # type: ignore[assignment]

    @property
    def path(self) -> Path:
        return self._path

    def __repr__(self) -> str:
        n = len(self.list_snapshots())
        return f"SnapshotManager(snapshots={n}, path={self._path!s})"
