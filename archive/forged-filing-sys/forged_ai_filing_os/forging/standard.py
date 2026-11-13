"""Forged File Standard (FFS) v1.2.0 — machine-readable source of truth.

Mirrors docs/FORGED_FILE_STANDARD.md. spec_version MUST equal the spec heading.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SpecVersion = Literal["1.2.0"]
PaletteColor = Literal["neutral", "orange", "yellow"]
StoreKind = Literal["skills", "intelligence"]
StageName = Literal["F0", "F1", "F2", "F3"]

SPEC_VERSION: SpecVersion = "1.2.0"

STAGE_ORDER: tuple[StageName, ...] = ("F0", "F1", "F2", "F3")
PALETTE: tuple[PaletteColor, ...] = ("neutral", "orange", "yellow")

CHUNK_KINDS = ("heading", "paragraph", "table", "code", "list")
CHUNK_CLASSIFICATIONS = ("code", "intelligence")

RAW_DIRNAME = "raw"
QUARANTINE_DIRNAME = "quarantine"
VENDOR_DIRNAME = "vendor"
FORGED_DIRNAME = "forged"
CAPABILITIES_DIRNAME = "capabilities"
MANIFEST_NAME = "manifest.json"

RAW_SIDECAR_NAME = "raw.json"
FORGED_SUFFIX = ".forged.json"
CAP_SUFFIX = ".cap.json"
FILE_ID_HEX_LEN = 16

# Immutability & versioning matrix (spec §3).
IMMUTABILITY_MATRIX = {
    "F0": ("immutable", "original evidence"),
    "F1": ("immutable", "deterministic chunk artifact"),
    "F2": ("immutable", "governed classified artifact"),
    "F3": ("append-only", "relationships / provenance"),
}

# RocksDB control-plane namespace schema (spec §5).
NAMESPACE_SCHEMA: dict[str, str] = {
    "skill": "{skill_id}",
    "capability": "{capability_id}",
    "asset": "{asset_id}",
    "layer": "{stack_id}:{layer_id}",
    "idx:hash": "{hash}",
    "idx:asset": "{asset_id}",
    "manifest": "{forged_id}",
    "stack": "{job_id}:{frame_id}:{depth}",
}

# Detector verdicts (spec §4) — no blind truncation, unknown → quarantine.
# `python` / `text_document` / `shell_script` / `text_config` / `web_asset_source`
# are text formats identified by the repo's declared filename + structural parse.
ARTIFACT_KINDS = ("safetensors", "gguf", "onnx", "tokenizer_config", "merges", "chat_template", "python", "text_document", "shell_script", "text_config", "web_asset_source", "unknown")

# Vendor import taxonomy (spec §4). `source` = executable/importable code
# (trust_remote_code modeling files); `document` = text docs (licenses,
# component cards). Both governed vendor assets — neither becomes a Forged File.
VENDOR_IMPORT_KINDS = ("config", "tokenizer", "model_metadata", "model_weights", "revision_hash", "source", "document")

VENDOR_URI_SCHEME = "vendor://"

# Canonical vocabulary (spec §1.1) — non-negotiable. There is NO harness layer:
# the Exoskeleton is the substrate/execution environment around Ava007, and
# capabilities belong to the Exoskeleton. Within a Capability, "harness" survives
# only as the execution-boundary section of the Capability entity itself.
VOCABULARY: dict[str, str] = {
    "Harness (as a layer)": "Exoskeleton",
    "Capability Harness": "Exoskeleton substrate",
    "Harness layer": "Exoskeleton layer / substrate primitive",
    "Harness execution": "Exoskeleton execution",
    "Harness around Ava": "Exoskeleton around Ava007",
    "Harness capabilities": "Exoskeleton capabilities",
    "GSAP": "temporal kernel (mandatory visual language for F1 chunking)",
    "Skills": "Intelligence / firmware",
    "RocksDB": "operational Skills / state (control plane)",
    "DuckDB": "Intelligence / queryable knowledge",
    "Forged File": "governed intelligence/skill artifact",
    "Hugging Face": "vendor boundary",
    "Exoskeleton": "substrate/execution environment around Ava007",
}

CAPABILITY_SECTIONS = (
    "dependencies", "tools", "skill", "harness", "inputs", "outputs",
    "permissions", "validation", "provenance",
)

# Animation semantics (spec §9) — never decoration.
ANIMATION_SEMANTICS: dict[str, str] = {
    "upload": "ascii_glitch_ripple",
    "f1_chunk": "gsap_split_text",
    "numeric": "odometer",
    "stage_transition": "slide",
    "dev_locked": "visible_inert_reduced_opacity_lock_glyph",
}

DEV_LOCKED = (
    "RocksDBStore/DuckDBStore fallback backends: file-JSON persistence until "
    "native engines are pinned",
    "GsapF1Visualizer consumers (BENTO UI): visual language consumers not yet wired",
    "Curation-config wiring (Mastering-Ava007-Curation explorer surfaces): not yet wired "
    "into this repo",
    "Detector parsers for sharded safetensors / ONNX protobuf graph: metadata-presence "
    "heuristics only",
    "Rev.ike zero-copy streaming substrate: specified with measured targets (0.00 MB RAM "
    "delta @ 50,000 records, 8,434.3 records/sec per the Aetheris architecture guide) — "
    "substrate primitive not yet present in this repo",
    "Vendored-model inference execution (e.g. vectionlabs/Salience-27B-R5): assets vendored "
    "at the boundary and weight shards registered as sha256-verified remote refs — local "
    "inference execution not yet operational in this repo",
    "GGUF code-substrate execution (DavidAU Qwen3.8-27B NEO-CODER, rev 89230607): 23 weight "
    "variants incl. mmproj registered as remote refs (389 GB vendor-side) — local inference "
    "execution not yet operational in this repo",
    "Audio-substrate execution (nvidia/Nemotron-Labs-Audex-30B-A3B, rev 4e7e3420): 51 vendor "
    "artifacts incl. trust_remote_code modeling source, 17 remote refs (71.6 GB vendor-side); "
    "noncommercial license — execution DEV-locked pending usage-scope review",
    "Agent-browser chat lens (/api/chat on ai-browser Pages): endpoint deployed and "
    "DEV-locked until HUGGINGFACE_TOKEN is set on the Pages project — dock visible + inert "
    "with reason displayed (§9)",
)


@dataclass(frozen=True)
class Stage:
    name: StageName
    requires: tuple[StageName, ...]
    description: str


@dataclass(frozen=True)
class StoreSpec:
    kind: StoreKind
    backend: str
    role: str
    dev_locked_backend: bool = False


@dataclass(frozen=True)
class ForgedFileStandard:
    """Immutable, machine-readable statement of the standard."""

    spec_version: SpecVersion = SPEC_VERSION
    stages: tuple[Stage, ...] = field(default_factory=lambda: (
        Stage("F0", (), "Raw Upload — immutable bytes by sha256, behind pre-check"),
        Stage("F1", ("F0",), "Chunk — GSAP Split Text, reversible, unembedded"),
        Stage("F2", ("F1",), "Forged File — classified, offset-verified, substrate-bound"),
        Stage("F3", ("F2",), "Manifest — append-only provenance & relationship graph"),
    ))
    stores: tuple[StoreSpec, ...] = field(default_factory=lambda: (
        StoreSpec("skills", "rocksdb", "executable procedural knowledge + control plane"),
        StoreSpec("intelligence", "duckdb", "structured knowledge"),
    ))
    palette: tuple[PaletteColor, ...] = PALETTE
    vocabulary: dict[str, str] = field(default_factory=lambda: dict(VOCABULARY))
    immutability: dict[str, tuple[str, str]] = field(default_factory=lambda: dict(IMMUTABILITY_MATRIX))
    namespaces: dict[str, str] = field(default_factory=lambda: dict(NAMESPACE_SCHEMA))
    animation_semantics: tuple[tuple[str, str], ...] = tuple(ANIMATION_SEMANTICS.items())
    dev_locked: tuple[str, ...] = DEV_LOCKED

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.spec_version != SPEC_VERSION:
            errors.append(f"spec_version {self.spec_version!r} != {SPEC_VERSION!r}")
        names = [s.name for s in self.stages]
        if names != list(STAGE_ORDER):
            errors.append(f"stage order {names} != {list(STAGE_ORDER)}")
        for stage in self.stages:
            for req in stage.requires:
                if req not in names:
                    errors.append(f"stage {stage.name} requires unknown stage {req}")
        if sorted(self.palette) != sorted(PALETTE):
            errors.append(f"palette {self.palette} != {PALETTE}")
        if not self.dev_locked:
            errors.append("DEV-lock register must not be empty while items are unmet")
        if len(self.stores) != 2 or {s.kind for s in self.stores} != {"skills", "intelligence"}:
            errors.append("exactly one skills (RocksDB) and one intelligence (DuckDB) store required")
        if set(self.immutability) != set(STAGE_ORDER):
            errors.append("immutability matrix must cover F0..F3")
        if not self.namespaces:
            errors.append("namespace schema must not be empty")
        if dict(self.animation_semantics) != dict(ANIMATION_SEMANTICS):
            errors.append("animation semantics must match ANIMATION_SEMANTICS")
        if "tools" not in CAPABILITY_SECTIONS or "harness" not in CAPABILITY_SECTIONS:
            errors.append("capability sections must include tools + harness (§6)")
        return errors


UI_CONTRACT = {
    "palette": {"neutral": ["shell", "F0", "F1", "F3", "vendor storage", "system infrastructure"],
                "orange": ["RocksDB", "Skills", "executable capabilities"],
                "yellow": ["DuckDB", "Intelligence", "structured knowledge"]},
    "dev_locked_surface": "visible · inert · reduced opacity + lock glyph",
    "explorer_mapping": {
        "title_path_bar": "vault root + current FFS zone",
        "left_navigation": "lifecycle zones",
        "central_canvas": "forged asset cards",
        "grid_list_modes": "two densities, same data",
        "breadcrumbs": "vault / zone / id",
        "search": "filter by id, source, domain, destination",
        "sorting": "forged_at | confidence | chunks | size",
        "inspector": "forged file + provenance + capability panels",
        "status_bar": "manifest summary + dev-lock count",
        "data_island": "explorer_state.ts state model, no external backend",
    },
}


def file_id_for(sha256: str) -> str:
    """Stable addressing: file_id is a pure function of F0 content digest."""
    return sha256[:FILE_ID_HEX_LEN]


def versioned_id(file_id: str, version: int) -> str:
    """Version addressing per spec §3: forged_id, forged_id:v2, forged_id:v3 …"""
    return file_id if version <= 1 else f"{file_id}:v{version}"


__all__ = [
    "SPEC_VERSION", "STAGE_ORDER", "PALETTE", "CHUNK_KINDS", "CHUNK_CLASSIFICATIONS",
    "VOCABULARY", "CAPABILITY_SECTIONS",
    "RAW_DIRNAME", "QUARANTINE_DIRNAME", "VENDOR_DIRNAME", "FORGED_DIRNAME",
    "CAPABILITIES_DIRNAME", "MANIFEST_NAME", "RAW_SIDECAR_NAME", "FORGED_SUFFIX",
    "CAP_SUFFIX", "FILE_ID_HEX_LEN", "IMMUTABILITY_MATRIX", "NAMESPACE_SCHEMA",
    "ARTIFACT_KINDS", "VENDOR_IMPORT_KINDS", "VENDOR_URI_SCHEME", "ANIMATION_SEMANTICS",
    "UI_CONTRACT", "Stage", "StoreSpec", "ForgedFileStandard", "file_id_for", "versioned_id",
]
