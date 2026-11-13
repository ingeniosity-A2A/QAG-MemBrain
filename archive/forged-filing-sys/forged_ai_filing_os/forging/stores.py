"""Dual stores: RocksDB Skills (procedural) + DuckDB Intelligence (structured).

Backend policy (docs/FORGED_FILE_STANDARD.md §2/§4):
- native engines (rocksdict / duckdb) when installed;
- explicit, DEV-locked in-memory fallbacks otherwise — never silent.

Neither store performs vectorization; F1 is unembedded and F2/F3 need none.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from .chunker import TextChunk
from .namespaces import validate_key


class ClassificationError(ValueError):
    """Raised when a chunk's classification cannot be determined."""


def classify_chunk(chunk: TextChunk) -> str:
    """Mandatory classification: code chunks → RocksDB, everything else → DuckDB."""
    if chunk.kind == "code":
        return "code"
    if chunk.kind in ("heading", "paragraph", "table", "list"):
        return "intelligence"
    raise ClassificationError(f"chunk {chunk.chunk_index} has unknown kind {chunk.kind!r}")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RocksDBStore:
    """Skills store — executable procedural knowledge (code chunks).

    Key/value semantics: insert returns an int u64 key (monotonic sequence);
    iterate_prefix(keys) yields (key, record) pairs ordered by key.
    """

    backend = "rocksdb"

    def __init__(self, path: Optional[str] = None):
        self.path = str(path) if path is not None else None
        self._dev_locked = False
        self._db = None
        self._mem: dict[int, dict] = {}     # forged skills (u64 sequence keys)
        self._kv: dict[str, dict] = {}      # control-plane namespace records
        self._n = 0
        try:
            from rocksdict import Rdict  # type: ignore
        except ImportError:
            # DEV-locked fallback: file-backed JSON so governance verification
            # works across processes even without the native engine.
            self._dev_locked = True
            self.backend = "file_json (DEV-locked fallback)"
            store_file = self._fallback_file()
            if store_file is not None and store_file.exists():
                for k, v in json.loads(store_file.read_text()).items():
                    if k.isdigit():
                        self._mem[int(k)] = v
                    else:
                        self._kv[k] = v
                self._n = max(self._mem, default=-1) + 1
        else:
            import tempfile

            target = self.path if self.path is not None else tempfile.mkdtemp(prefix="ava007-skills-")
            self._db = Rdict(target)
            self._n = len(self._db)

    @property
    def dev_locked(self) -> bool:
        return self._dev_locked

    def _fallback_file(self):
        return Path(self.path + ".skills.json") if self.path is not None else None

    def _persist_fallback(self) -> None:
        store_file = self._fallback_file()
        if store_file is not None:
            store_file.parent.mkdir(parents=True, exist_ok=True)
            payload = {**{str(k): v for k, v in sorted(self._mem.items())}, **self._kv}
            store_file.write_text(json.dumps(payload, ensure_ascii=False))

    def insert(self, payload: dict) -> int:
        key = self._n
        self._n += 1
        record = {**payload, "stored_at": _utc_now()}
        if self._db is not None:
            self._db[key] = json.dumps(record, ensure_ascii=False)
        else:
            self._mem[key] = record
            self._persist_fallback()
        return key

    # -- control-plane namespace API (spec §5) -----------------------------------
    def put_value(self, key: str, value: dict) -> str:
        """Write a namespaced control-plane record (skill:, capability:, …)."""
        validate_key(key)
        encoded = json.dumps({**value, "stored_at": _utc_now()}, ensure_ascii=False)
        if self._db is not None:
            self._db[key] = encoded
        else:
            self._kv[key] = {**value, "stored_at": _utc_now()}
            self._persist_fallback()
        return key

    def get_value(self, key: str) -> Optional[dict]:
        validate_key(key)
        if self._db is not None:
            raw = self._db.get(key)
            return None if raw is None else json.loads(raw)
        return self._kv.get(key)

    def prefix_scan(self, namespace: str) -> list[tuple[str, dict]]:
        """All records under one namespace, ordered by key."""
        prefix = f"{namespace}:"
        out: list[tuple[str, dict]] = []
        if self._db is not None:
            try:
                items = self._db.items()
            except AttributeError:
                items = []
            for k, raw in items:
                ks = k.decode() if isinstance(k, bytes) else k
                if isinstance(ks, str) and ks.startswith(prefix):
                    try:
                        out.append((ks, json.loads(raw)))
                    except (TypeError, ValueError):
                        continue
        else:
            for k in sorted(self._kv):
                if k.startswith(prefix):
                    out.append((k, self._kv[k]))
        return out

    def get(self, key: int) -> Optional[dict]:
        if self._db is not None:
            raw = self._db.get(key)
            return None if raw is None else json.loads(raw)
        return self._mem.get(key)

    def iterate_prefix(self, keys: list[int]) -> Iterator[tuple[int, dict]]:
        for key in sorted(keys):
            record = self.get(key)
            if record is not None:
                yield key, record

    def close(self) -> None:
        if self._db is not None:
            self._db.close()
            self._db = None


class DuckDBStore:
    """Intelligence store — structured knowledge (SQL over intelligence_chunks)."""

    backend = "duckdb"

    SCHEMA = """
    CREATE TABLE IF NOT EXISTS intelligence_chunks (
        chunk_key      BIGINT PRIMARY KEY,
        file_id        VARCHAR NOT NULL,
        chunk_index    INTEGER NOT NULL,
        doc_id         VARCHAR NOT NULL,
        kind           VARCHAR NOT NULL,
        text           VARCHAR NOT NULL,
        classification VARCHAR NOT NULL,
        domain         VARCHAR NOT NULL DEFAULT 'general',
        forged_at      VARCHAR NOT NULL
    );
    """

    COLUMNS = ("chunk_key", "file_id", "chunk_index", "doc_id", "kind",
               "text", "classification", "domain", "forged_at")

    def __init__(self, path: Optional[str] = None):
        self.path = str(path) if path is not None else None
        self._dev_locked = False
        self._con = None
        self._mem: list[dict] = []
        self._n = 0
        try:
            import duckdb  # type: ignore
        except ImportError:
            # DEV-locked fallback: file-backed JSON so governance verification
            # works across processes even without the native engine.
            self._dev_locked = True
            self.backend = "file_json (DEV-locked fallback)"
            store_file = self._fallback_file()
            if store_file is not None and store_file.exists():
                self._mem = json.loads(store_file.read_text())
                self._n = max((int(r["chunk_key"]) for r in self._mem), default=-1) + 1
        else:
            target = self.path if self.path is not None else ":memory:"
            self._con = duckdb.connect(target)
            self._con.execute(self.SCHEMA)
            row = self._con.execute(
                "SELECT COALESCE(MAX(chunk_key), -1) + 1 FROM intelligence_chunks"
            ).fetchone()
            self._n = int(row[0])

    @property
    def dev_locked(self) -> bool:
        return self._dev_locked

    def _fallback_file(self):
        return Path(self.path + ".intelligence.json") if self.path is not None else None

    def insert(self, payload: dict) -> int:
        key = self._n
        self._n += 1
        record = {
            "chunk_key": key,
            "file_id": payload.get("file_id", ""),
            "chunk_index": int(payload.get("chunk_index", 0)),
            "doc_id": payload.get("doc_id", ""),
            "kind": payload.get("kind", "paragraph"),
            "text": payload.get("text", ""),
            "classification": payload.get("classification", "intelligence"),
            "domain": payload.get("domain", "general"),
            "forged_at": payload.get("forged_at") or _utc_now(),
        }
        if self._con is not None:
            self._con.execute(
                "INSERT INTO intelligence_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [record[c] for c in self.COLUMNS],
            )
        else:
            self._mem.append(record)
            store_file = self._fallback_file()
            if store_file is not None:
                store_file.parent.mkdir(parents=True, exist_ok=True)
                store_file.write_text(json.dumps(self._mem, ensure_ascii=False))
        return key

    def count(self, classification: Optional[str] = None, domain: Optional[str] = None) -> int:
        if self._con is not None:
            sql, params = self._filtered(classification, domain)
            return int(self._con.execute(f"SELECT COUNT(*) FROM intelligence_chunks{sql}", params).fetchone()[0])
        return sum(
            1
            for r in self._mem
            if (classification is None or r["classification"] == classification)
            and (domain is None or r["domain"] == domain)
        )

    def fetch(self, classification: Optional[str] = None, domain: Optional[str] = None,
              limit: Optional[int] = None) -> list[dict]:
        if self._con is not None:
            where, params = self._filtered(classification, domain)
            sql = f"SELECT {', '.join(self.COLUMNS)} FROM intelligence_chunks{where} ORDER BY chunk_key"
            if limit is not None:
                sql += " LIMIT ?"
                params = [*params, int(limit)]
            return [dict(zip(self.COLUMNS, row)) for row in self._con.execute(sql, params).fetchall()]
        rows = [
            dict(r)
            for r in self._mem
            if (classification is None or r["classification"] == classification)
            and (domain is None or r["domain"] == domain)
        ]
        rows.sort(key=lambda r: r["chunk_key"])
        return rows[: int(limit)] if limit is not None else rows

    def domains(self) -> list[str]:
        if self._con is not None:
            return [r[0] for r in self._con.execute(
                "SELECT DISTINCT domain FROM intelligence_chunks ORDER BY domain"
            ).fetchall()]
        return sorted({r["domain"] for r in self._mem})

    @staticmethod
    def _filtered(classification: Optional[str], domain: Optional[str]) -> tuple[str, list]:
        clauses, params = [], []
        if classification is not None:
            clauses.append("classification = ?")
            params.append(classification)
        if domain is not None:
            clauses.append("domain = ?")
            params.append(domain)
        return (f" WHERE {' AND '.join(clauses)}", params) if clauses else ("", params)

    def close(self) -> None:
        if self._con is not None:
            self._con.close()
            self._con = None


__all__ = ["RocksDBStore", "DuckDBStore", "classify_chunk", "ClassificationError"]
