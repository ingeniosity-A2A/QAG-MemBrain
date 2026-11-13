"""Forging pipeline: one governed path Pre-check → Intercept → F0 → F1 → … → F2 → stores → F3.

Enforces docs/FORGED_FILE_STANDARD.md v1.1.0:
- pre-check gates the F0 boundary; nothing is written on failure;
- the intercept stage routes by detector verdict — never blind truncation;
- F0/F1/F2 immutable (matrix §3); F3 append-only; changes mint forged_id:vN;
- F1 structural chunking, reversible, unembedded; normalize records metadata only;
- Exoskeleton substrate binding wraps executable intent without executing anything
  (Capability = Tools + Harness; there is no harness layer, spec §1.1/§6);
- mandatory classification routes code→RocksDB (control plane included) and the
  rest→DuckDB;
- vendor isolation: model artifacts go to the vendor store or quarantine, never
  into the lifecycle, and weights never enter RocksDB.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .chunker import GSAPChunker, GsapF1Visualizer
from .detector import Verdict, detect
from .manifest import ForgeManifest, ManifestEntry
from .namespaces import idx_hash_key, manifest_key, skill_key
from .standard import (
    FILE_ID_HEX_LEN,
    FORGED_DIRNAME,
    FORGED_SUFFIX,
    MANIFEST_NAME,
    QUARANTINE_DIRNAME,
    RAW_DIRNAME,
    RAW_SIDECAR_NAME,
    SPEC_VERSION,
    VENDOR_DIRNAME,
    file_id_for,
    versioned_id,
)
from .stores import DuckDBStore, RocksDBStore, classify_chunk
from .vendor import VendorError, VendorRegistry

MAX_RAW_BYTES = 64 * 1024 * 1024
MODEL_KINDS = ("safetensors", "gguf", "onnx")


class PrecheckError(ValueError):
    """Pre-check failed at the F0 boundary; nothing was written."""


@dataclass(frozen=True)
class ForgedArtifact:
    """Result of driving one file through the full lifecycle."""

    file_id: str
    version: int
    sha256: str
    size: int
    mime: str
    chunk_count: int
    forged_at: str
    skills_keys: tuple[int, ...]
    intelligence_keys: tuple[int, ...]
    skill_ids: tuple[str, ...]
    detector: dict


class ForgingPipeline:
    def __init__(
        self,
        vault: Path,
        skills_store: Optional[RocksDBStore] = None,
        intelligence_store: Optional[DuckDBStore] = None,
        visualizer: Optional[GsapF1Visualizer] = None,
        manifest: Optional[ForgeManifest] = None,
        vendor_registry: Optional[VendorRegistry] = None,
    ):
        self.vault = Path(vault)
        self.raw_dir = self.vault / RAW_DIRNAME
        self.quarantine_dir = self.vault / QUARANTINE_DIRNAME
        self.forged_dir = self.vault / FORGED_DIRNAME
        self.forged_dir.mkdir(parents=True, exist_ok=True)
        self.skills_store = skills_store or RocksDBStore(str(self.vault / "rocksdb_skills"))
        self.intelligence_store = intelligence_store or DuckDBStore(
            str(self.vault / "intelligence.duckdb")
        )
        self.visualizer = visualizer or GsapF1Visualizer()
        self.manifest = manifest or ForgeManifest(self.vault / MANIFEST_NAME)
        self.vendor = vendor_registry or VendorRegistry(self.vault)

    # -- Pre-check: the F0 boundary ------------------------------------------------
    def precheck(self, data: bytes, source: str, mime: str) -> None:
        errors: list[str] = []
        if not data:
            errors.append("empty payload refused at the F0 boundary")
        if len(data) > MAX_RAW_BYTES:
            errors.append(f"payload {len(data)} bytes exceeds pre-check limit {MAX_RAW_BYTES}")
        if not source:
            errors.append("explicit source is required at the F0 boundary")
        if not mime:
            errors.append("mime hint is required at the F0 boundary")
        if errors:
            raise PrecheckError("pre-check failed: " + "; ".join(errors))

    # -- F0 (forge route) ------------------------------------------------------------
    def upload_raw(self, data: bytes, source: str, mime: str = "text/plain") -> str:
        """Forge-route F0 upload. Caller has declared forging intent at the intercept."""
        self.precheck(data, source, mime)
        verdict = detect(data)
        sha = hashlib.sha256(data).hexdigest()
        raw_dir = self.raw_dir / sha
        raw_file = raw_dir / "content.bin"
        if raw_file.exists():
            # F0 is write-once: identical bytes are already stored (the directory
            # is content-addressed), so this is crash-recovery resume, not mutation.
            # Finish an interrupted sidecar write if the crash left one behind.
            sidecar = raw_dir / RAW_SIDECAR_NAME
            if not sidecar.exists():
                sidecar.write_text(json.dumps({
                    "source": source,
                    "mime": mime,
                    "size": len(data),
                    "sha256": sha,
                    "route": "forge",
                    "detector": verdict.to_dict(),
                    "uploaded_at": datetime.now(timezone.utc).isoformat(),
                }, indent=2))
            return sha
        raw_dir.mkdir(parents=True)
        raw_file.write_bytes(data)
        (raw_dir / RAW_SIDECAR_NAME).write_text(json.dumps({
            "source": source,
            "mime": mime,
            "size": len(data),
            "sha256": sha,
            "route": "forge",
            "detector": verdict.to_dict(),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }, indent=2))
        return sha

    # -- Intercept / auto-routing -----------------------------------------------------
    def intake(
        self,
        data: bytes,
        source: str,
        mime: str = "application/octet-stream",
        vendor_repo_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Auto-route at the intercept stage: vendor | quarantine | forge.

        Model formats (safetensors/gguf/onnx/tokenizer) never enter the lifecycle:
        with a vendor repo id they import vendor-side, otherwise they quarantine.
        """
        self.precheck(data, source, mime)
        verdict = detect(data)
        if verdict.kind in MODEL_KINDS or verdict.kind == "tokenizer_config":
            if verdict.quarantine:
                self.quarantine(data, source, verdict)
                return {"route": "quarantine", "verdict": verdict.to_dict()}
            if vendor_repo_id is None:
                self.quarantine(data, source, verdict)
                return {"route": "quarantine", "verdict": verdict.to_dict(),
                        "reason": "model artifact without vendor context"}
            try:
                imp = self.vendor.import_artifact(data, vendor_repo_id, source, verdict)
            except VendorError:
                self.quarantine(data, source, verdict)
                return {"route": "quarantine", "verdict": verdict.to_dict()}
            return {"route": "vendor", "import": imp.to_dict()}
        # Forgeable content continues to F0; unrecognized *binary* quarantines.
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            self.quarantine(data, source, verdict)
            return {"route": "quarantine", "verdict": verdict.to_dict(),
                    "reason": "unrecognized binary format"}
        sha = self.upload_raw(data, source, mime)
        return {"route": "forge", "sha256": sha, "verdict": verdict.to_dict()}

    def quarantine(self, data: bytes, source: str, verdict: Verdict) -> str:
        """Store an unidentifiable artifact outside the lifecycle (spec §4)."""
        sha = hashlib.sha256(data).hexdigest()
        qdir = self.quarantine_dir / sha
        if not (qdir / "content.bin").exists():
            qdir.mkdir(parents=True, exist_ok=True)
            (qdir / "content.bin").write_bytes(data)
            (qdir / "verdict.json").write_text(json.dumps({
                "source": source,
                "sha256": sha,
                "size": len(data),
                "detector": verdict.to_dict(),
                "quarantined_at": datetime.now(timezone.utc).isoformat(),
            }, indent=2))
        return sha

    # -- F1 → F2 --------------------------------------------------------------------
    def forge(
        self,
        sha256: str,
        domain: str = "general",
        source: str = "unknown",
        mime: str = "text/plain",
    ) -> ForgedArtifact:
        base = file_id_for(sha256)
        if self.manifest.get(base) is not None:
            raise FileExistsError(f"{base} is already forged (F2 immutable)")
        return self._forge(sha256, domain, source, mime, base, version=1)

    def reforge(
        self,
        sha256: str,
        domain: str = "general",
        source: str = "unknown",
        mime: str = "text/plain",
        lineage: Optional[str] = None,
    ) -> ForgedArtifact:
        """Forge changed content as a new immutable version (spec §3): forged_id:vN.

        ``lineage`` is the previous forged_id (v1 or :vN) in the F3 manifest; the
        new content must already be uploaded to F0 under its own (different) digest.
        Without lineage, reforge refuses when the base id is already forged —
        F2 is immutable; changed content mints the next version instead.
        """
        if lineage:
            base = lineage.split(":v", 1)[0]
            if self.manifest.get(base) is None:
                raise FileNotFoundError(f"lineage {base} not found in F3 manifest")
            versions = [1]
            for e in self.manifest.all():
                if e.file_id.startswith(f"{base}:v"):
                    try:
                        versions.append(int(e.file_id.split(":v", 1)[1]))
                    except ValueError:
                        continue
            version = max(versions) + 1
        else:
            base = file_id_for(sha256)
            if self.manifest.get(base) is not None:
                raise FileExistsError(
                    f"{base} is already forged (F2 immutable) — supply lineage for changed content"
                )
            version = 1
        return self._forge(sha256, domain, source, mime,
                           versioned_id(base, version), version=version)

    def _forge(
        self,
        sha256: str,
        domain: str,
        source: str,
        mime: str,
        forged_id: str,
        version: int,
    ) -> ForgedArtifact:
        raw_dir = self.raw_dir / sha256
        raw_file = raw_dir / "content.bin"
        if not raw_file.exists():
            raise FileNotFoundError(f"no F0 raw upload for {sha256[:FILE_ID_HEX_LEN]}")

        data = raw_file.read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"F1 requires UTF-8 text for chunking: {exc}") from exc

        doc_id = sha256[:12]
        chunker = GSAPChunker(doc_id, visualizer=self.visualizer)
        chunks = chunker.chunk(text)

        # --- governance validations (halt on failure) -----------------------------
        errors = []
        for label, check in (
            ("offsets", lambda: GSAPChunker.offsets_within(chunks, len(data))),
            ("reversibility", lambda: GSAPChunker.reversibility_error(chunks, text)),
        ):
            err = check()
            if err:
                errors.append(f"{label}: {err}")
        if errors:
            raise ValueError("F1 validation failed — " + "; ".join(errors))

        forged_at = datetime.now(timezone.utc).isoformat()

        skills_keys: list[int] = []
        intelligence_keys: list[int] = []
        skill_ids: list[str] = []
        execution_context = {
            "entrypoint": "skill_chunk",
            "inputs": {"file_id": forged_id, "chunk_index": "int"},
            "outputs": {"executable": "bool"},
            "permissions": {"execute": False},   # substrate never executes during forging
        }
        for chunk in chunks:
            classification = classify_chunk(chunk)  # mandatory (rule 6)
            payload = {
                "file_id": forged_id,
                "chunk_index": chunk.chunk_index,
                "doc_id": chunk.doc_id,
                "kind": chunk.kind,
                "text": chunk.text,
                "sep_after": chunk.sep_after,
                "domain": domain,
                "forged_at": forged_at,
                "classification": classification,
            }
            if classification == "code":
                key = self.skills_store.insert({**payload, "execution_context": execution_context})
                skills_keys.append(key)
                # Control-plane registration (spec §5): skill:{skill_id}
                skill_id = f"{forged_id}:{chunk.chunk_index}"
                self.skills_store.put_value(skill_key(skill_id), {
                    "skill_id": skill_id,
                    "forged_id": forged_id,
                    "chunk_index": chunk.chunk_index,
                    "store_key": key,
                    "domain": domain,
                })
                skill_ids.append(skill_id)
            else:
                intelligence_keys.append(self.intelligence_store.insert(payload))

        # Normalize stage: metadata only — presentation never rewrites evidence.
        normalize_meta = {
            "whitespace_preserved": True,
            "presentation_copy_only": True,
            "reversibility_target": "raw F0 bytes",
        }

        artifact = {
            "spec": "forged-file-standard",
            "version": SPEC_VERSION,
            "file_id": forged_id,
            "revision": version,
            "f0": {"sha256": sha256, "size": len(data), "mime": mime},
            "chunks": [c.to_dict() for c in chunks],
            "stats": {
                "total": len(chunks),
                "code": len(skills_keys),
                "intelligence": len(intelligence_keys),
            },
            "execution_context": execution_context,
            "normalize": normalize_meta,
            "forged_at": forged_at,
        }

        # Offset re-verification against the F0 digest before binding (rule 4).
        rebuilt = "".join(c["text"] + c["sep_after"] for c in artifact["chunks"])
        if hashlib.sha256(rebuilt.encode("utf-8")).hexdigest() != sha256:
            raise ValueError(f"F2 forge rejected: chunk reconstruction mismatch for {forged_id}")

        forged_path = self.forged_dir / f"{forged_id.replace(':', '#')}{FORGED_SUFFIX}"
        if forged_path.exists():
            raise FileExistsError(f"forge already exists for {forged_id}")
        forged_path.write_text(json.dumps(artifact, indent=2, ensure_ascii=False))

        entry = ManifestEntry(
            file_id=forged_id,
            version=version,
            sha256=sha256,
            size=len(data),
            mime=mime,
            source=source,
            domain=domain,
            forged_at=forged_at,
            chunk_count=len(chunks),
            skills_count=len(skills_keys),
            intelligence_count=len(intelligence_keys),
            backlinks={
                "source": source,
                "forged_path": str(forged_path),
                "raw_path": str(raw_dir),
                "skills_keys": list(skills_keys),
                "intelligence_keys": list(intelligence_keys),
                "skill_ids": list(skill_ids),
            },
        )
        self.manifest.register(entry)

        # Control-plane indexes (spec §5): idx:hash + manifest pointers.
        self.skills_store.put_value(idx_hash_key(sha256), {
            "forged_id": forged_id, "sha256": sha256,
        })
        self.skills_store.put_value(manifest_key(forged_id), {
            "forged_id": forged_id,
            "manifest": str(self.manifest.path),
            "domain": domain,
        })

        return ForgedArtifact(
            file_id=forged_id,
            version=version,
            sha256=sha256,
            size=len(data),
            mime=mime,
            chunk_count=len(chunks),
            forged_at=forged_at,
            skills_keys=tuple(skills_keys),
            intelligence_keys=tuple(intelligence_keys),
            skill_ids=tuple(skill_ids),
            detector=verdict_dict_from(raw_dir),
        )

    # -- helpers -----------------------------------------------------------------
    def get_artifact(self, file_id: str) -> Optional[dict]:
        p = self.forged_dir / f"{file_id.replace(':', '#')}{FORGED_SUFFIX}"
        return json.loads(p.read_text()) if p.exists() else None

    def verify_file(self, file_id: str) -> tuple[bool, str]:
        """Re-verify chunk reversibility + store placement for one forged file."""
        artifact = self.get_artifact(file_id)
        if artifact is None:
            return False, f"unknown file_id {file_id}"
        entry = self.manifest.get(file_id)
        if entry is None:
            return False, "not registered in F3 manifest"

        rebuilt = "".join(c["text"] + c["sep_after"] for c in artifact["chunks"])
        if hashlib.sha256(rebuilt.encode("utf-8")).hexdigest() != artifact["f0"]["sha256"]:
            return False, "reconstruction mismatch vs F0 digest"

        # Store keys are per-store sequences; coverage is by counts + presence.
        skills_keys = set(entry.backlinks.get("skills_keys", []))
        intel_keys = set(entry.backlinks.get("intelligence_keys", []))
        if len(skills_keys) + len(intel_keys) != artifact["stats"]["total"]:
            return False, "backlink counts do not cover chunk set"
        for key in sorted(skills_keys):
            if self.skills_store.get(key) is None:
                return False, f"skills key {key} missing from RocksDB store"
        for skill_id in entry.backlinks.get("skill_ids", []):
            if self.skills_store.get_value(skill_key(skill_id)) is None:
                return False, f"control-plane skill {skill_id} missing"
        intel_present = {r["chunk_key"] for r in self.intelligence_store.fetch(limit=None)}
        missing = intel_keys - intel_present
        if missing:
            return False, f"intelligence keys missing from DuckDB store: {sorted(missing)}"
        return True, "ok"

    def trace(self, file_id: str) -> dict:
        """The §3 traceability chain: skill → forged file → chunks → upload → vendor."""
        entry = self.manifest.get(file_id)
        if entry is None:
            return {"error": f"unknown forged_id {file_id}"}
        capabilities = []
        caps_dir = self.vault / "forge" / "capabilities"
        if caps_dir.exists():
            for cap_file in sorted(caps_dir.glob("*.cap.json")):
                cap = json.loads(cap_file.read_text())
                if cap.get("provenance", {}).get("forged_id") == file_id:
                    vendor_refs = [
                        ref for ref in (cap.get("dependencies") or {}).values()
                        if isinstance(ref, str) and ref.startswith("vendor://")
                    ]
                    capabilities.append({
                        "capability_id": cap["capability_id"],
                        "skill_id": cap.get("provenance", {}).get("skill_id"),
                        "vendor_contributions": vendor_refs,
                    })
        return {
            "question": "Why does this skill exist?",
            "forged_file": file_id,
            "version": entry.version,
            "chunks": entry.chunk_count,
            "upload": {
                "sha256": entry.sha256,
                "source": entry.source,
                "raw_sidecar": str(Path(entry.backlinks.get("raw_path", "")) / RAW_SIDECAR_NAME)
                if entry.backlinks.get("raw_path") else None,
            },
            "stores": {
                "rocksdb_skills": entry.skills_count,
                "duckdb_intelligence": entry.intelligence_count,
            },
            "capabilities": capabilities,
            "vendor": self.vendor.summary(),
        }

    def close(self) -> None:
        self.skills_store.close()
        self.intelligence_store.close()


def verdict_dict_from(raw_dir: Path) -> dict:
    sidecar = raw_dir / RAW_SIDECAR_NAME
    if sidecar.exists():
        return json.loads(sidecar.read_text()).get("detector", {})
    return {}


__all__ = ["ForgingPipeline", "ForgedArtifact", "PrecheckError", "MAX_RAW_BYTES", "MODEL_KINDS"]
