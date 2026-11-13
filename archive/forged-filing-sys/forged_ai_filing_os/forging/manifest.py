"""F3 Manifest — provenance & relationship graph for all forged files."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .standard import MANIFEST_NAME


@dataclass(frozen=True)
class ManifestEntry:
    file_id: str          # forged_id; may carry :vN version suffix (spec §3)
    version: int
    sha256: str
    size: int
    mime: str
    source: str
    domain: str
    forged_at: str
    chunk_count: int
    skills_count: int
    intelligence_count: int
    backlinks: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "file_id": self.file_id,
            "version": self.version,
            "sha256": self.sha256,
            "size": self.size,
            "mime": self.mime,
            "source": self.source,
            "domain": self.domain,
            "forged_at": self.forged_at,
            "chunk_count": self.chunk_count,
            "skills_count": self.skills_count,
            "intelligence_count": self.intelligence_count,
            "backlinks": self.backlinks,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ManifestEntry":
        return cls(
            file_id=d["file_id"],
            version=int(d.get("version", 1)),
            sha256=d["sha256"],
            size=int(d["size"]),
            mime=d["mime"],
            source=d["source"],
            domain=d["domain"],
            forged_at=d["forged_at"],
            chunk_count=int(d["chunk_count"]),
            skills_count=int(d["skills_count"]),
            intelligence_count=int(d["intelligence_count"]),
            backlinks=d.get("backlinks", {}),
        )


class ForgeManifest:
    """Durable F3 manifest: append-only JSON file with per-file provenance."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._entries: dict[str, ManifestEntry] = {}
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            data = json.loads(self.path.read_text())
            for d in data.get("files", []):
                e = ManifestEntry.from_dict(d)
                self._entries[e.file_id] = e

    def register(self, entry: ManifestEntry) -> None:
        if entry.file_id in self._entries:
            raise FileExistsError(f"F3 already contains {entry.file_id}")
        self._entries[entry.file_id] = entry
        self._save()

    def get(self, file_id: str) -> Optional[ManifestEntry]:
        return self._entries.get(file_id)

    def all(self) -> list[ManifestEntry]:
        return list(self._entries.values())

    def backlinks_to(self, file_id: str) -> list[str]:
        """Sources that fed a forged file (source → forged edge)."""
        e = self._entries.get(file_id)
        return [e.backlinks.get("source", "")] if e else []

    def backlinks_from(self, file_id: str) -> list[str]:
        """Store placements a forged file owns (forged → store edges)."""
        e = self._entries.get(file_id)
        if not e:
            return []
        return [
            f"rocksdb:{k}" for k in e.backlinks.get("skills_keys", [])
        ] + [f"duckdb:{k}" for k in e.backlinks.get("intelligence_keys", [])]

    def summary(self) -> dict:
        files = self.all()
        return {
            "total_files": len(files),
            "total_chunks": sum(f.chunk_count for f in files),
            "skills_chunks": sum(f.skills_count for f in files),
            "intelligence_chunks": sum(f.intelligence_count for f in files),
            "domains": sorted({f.domain for f in files}),
            "sources": sorted({f.source for f in files}),
        }

    def _save(self) -> None:
        payload = {
            "spec": "forged-file-standard",
            "version": "1.0.0",
            "files": [e.to_dict() for e in sorted(
                self._entries.values(), key=lambda e: e.forged_at
            )],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))


__all__ = ["ForgeManifest", "ManifestEntry"]
