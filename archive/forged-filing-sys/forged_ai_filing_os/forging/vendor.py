"""Vendor boundary (spec §4) — Hugging Face imports, OUTSIDE F0 → F3.

A model does not become a Forged File merely because a Capability uses it.
The vendor system keeps its own content-addressed, immutable store:

  vault/vendor/imports/<sha256>/   artifact + import.json (immutable)
  vault/vendor/meta/{repo_id}.json metadata facts exported toward DuckDB

Only metadata/facts derived from the detector's declared headers cross into the
intelligence plane. Weights never leave the vendor store and never enter RocksDB.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .detector import Verdict, detect
from .standard import VENDOR_DIRNAME, VENDOR_IMPORT_KINDS, VENDOR_URI_SCHEME


class VendorError(ValueError):
    pass


def vendor_uri(sha256: str, filename: str = "") -> str:
    """Content-addressed vendor URI: vendor://<sha256>/<filename>."""
    return f"{VENDOR_URI_SCHEME}{sha256}/{filename}" if filename else f"{VENDOR_URI_SCHEME}{sha256}"


@dataclass(frozen=True)
class VendorImport:
    sha256: str
    repo_id: str
    filename: str
    kind: str                  # VENDOR_IMPORT_KINDS member
    size: int
    imported_at: str
    detector: dict
    meta_path: Optional[str] = None

    @property
    def uri(self) -> str:
        return vendor_uri(self.sha256, self.filename)

    def to_dict(self) -> dict:
        d = {
            "sha256": self.sha256,
            "repo_id": self.repo_id,
            "filename": self.filename,
            "kind": self.kind,
            "size": self.size,
            "imported_at": self.imported_at,
            "uri": self.uri,
            "detector": self.detector,
        }
        if self.meta_path:
            d["meta_path"] = self.meta_path
        return d


def _kind_for(filename: str, verdict: Verdict) -> str:
    name = filename.lower()
    if verdict.kind in ("tokenizer_config", "merges", "chat_template") or name.endswith((".json",)):
        if any(t in name for t in ("tokenizer", "vocab", "merges", "template")):
            return "tokenizer"
        return "config"
    if verdict.kind in ("safetensors", "gguf", "onnx"):
        return "model_weights" if name.endswith((".safetensors", ".gguf", ".onnx", ".bin")) else "model_metadata"
    if name.endswith((".msgpack", ".h5", ".ckpt", ".pt", ".pth")):
        return "model_weights"
    if verdict.kind == "python" or name.endswith((".py", ".sh", ".js", ".mjs")):
        return "source"
    if verdict.kind in ("text_document", "shell_script", "text_config", "web_asset_source"):
        return "document"
    return "model_metadata"


class VendorRegistry:
    """Immutable, content-addressed vendor asset store (outside the lifecycle)."""

    def __init__(self, vault: Path):
        self.vault = Path(vault)
        self.imports_dir = self.vault / VENDOR_DIRNAME / "imports"
        self.meta_dir = self.vault / VENDOR_DIRNAME / "meta"

    # -- import -----------------------------------------------------------------
    def import_artifact(
        self,
        data: bytes,
        repo_id: str,
        filename: str,
        verdict: Optional[Verdict] = None,
    ) -> VendorImport:
        verdict = verdict or detect(data)
        if verdict.quarantine:
            raise VendorError(
                f"vendor import refused for {filename}: detector verdict "
                f"{verdict.kind} (parse_ok={verdict.parse_ok}) — route to quarantine, not vendor"
            )
        sha = hashlib.sha256(data).hexdigest()
        target = self.imports_dir / sha
        artifact_file = target / filename
        if artifact_file.exists():
            raise FileExistsError(f"vendor immutability: {sha[:16]}/{filename} already imported")
        target.mkdir(parents=True, exist_ok=True)
        artifact_file.parent.mkdir(parents=True, exist_ok=True)  # nested repo paths (§4)
        artifact_file.write_bytes(data)

        kind = _kind_for(filename, verdict)
        if kind not in VENDOR_IMPORT_KINDS:
            raise VendorError(f"derived vendor kind {kind!r} outside taxonomy")

        meta_path: Optional[str] = None
        if kind in ("model_metadata", "model_weights", "config", "tokenizer", "source", "document"):
            facts = {
                "repo_id": repo_id,
                "filename": filename,
                "kind": kind,
                "sha256": sha,
                "uri": vendor_uri(sha, filename),
                "detector": verdict.to_dict(),
                "facts": verdict.declared,   # model intelligence: header-derived facts only
            }
            meta_file = self.meta_dir / f"{repo_id.replace('/', '__')}.json"
            meta_file.parent.mkdir(parents=True, exist_ok=True)
            existing = json.loads(meta_file.read_text()) if meta_file.exists() else {"repo_id": repo_id, "artifacts": {}}
            existing["artifacts"][filename] = facts
            meta_file.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
            meta_path = str(meta_file)

        imp = VendorImport(
            sha256=sha,
            repo_id=repo_id,
            filename=filename,
            kind=kind,
            size=len(data),
            imported_at=datetime.now(timezone.utc).isoformat(),
            detector=verdict.to_dict(),
            meta_path=meta_path,
        )
        (target / "import.json").write_text(json.dumps(imp.to_dict(), indent=2))
        return imp

    # -- lookup -------------------------------------------------------------------
    def get_meta(self, repo_id: str) -> Optional[dict]:
        meta_file = self.meta_dir / f"{repo_id.replace('/', '__')}.json"
        return json.loads(meta_file.read_text()) if meta_file.exists() else None

    def all_imports(self) -> list[VendorImport]:
        out: list[VendorImport] = []
        if not self.imports_dir.exists():
            return out
        for imp_file in sorted(self.imports_dir.glob("*/import.json")):
            d = json.loads(imp_file.read_text())
            out.append(VendorImport(
                sha256=d["sha256"], repo_id=d["repo_id"], filename=d["filename"],
                kind=d["kind"], size=int(d["size"]), imported_at=d["imported_at"],
                detector=d.get("detector", {}), meta_path=d.get("meta_path"),
            ))
        return out

    def summary(self) -> dict:
        imports = self.all_imports()
        by_kind: dict[str, int] = {}
        for imp in imports:
            by_kind[imp.kind] = by_kind.get(imp.kind, 0) + 1
        return {"total": len(imports), "by_kind": by_kind,
                "stores": sorted({VENDOR_URI_SCHEME + imp.sha256[:12] for imp in imports})}


__all__ = ["VendorRegistry", "VendorImport", "VendorError", "vendor_uri"]
