"""Capability = Tools + Harness — the compile-time unit (spec §6).

A Capability is NOT a harness and there is no harness architecture. It is the
complete executable unit produced by combining:

    TOOLS     — what it can use/do
    HARNESS   — the execution boundary/context that makes those tools usable
      ↓
    CAPABILITY — the resulting governed, executable unit

Compiled structure:

    CAPABILITY
    ├── dependencies
    ├── tools
    ├── skill
    ├── harness
    ├── inputs
    ├── outputs
    ├── permissions
    ├── validation
    └── provenance

Capabilities belong to the **Exoskeleton** — the substrate/execution environment
around Ava007 — never to a separate harness layer. The compiled capability is
registered in the RocksDB control plane at `capability:{capability_id}` and binds
provenance to the Forged File that produced its skill.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .namespaces import capability_key, skill_key
from .standard import CAPABILITIES_DIRNAME, CAP_SUFFIX, SPEC_VERSION, VENDOR_URI_SCHEME
from .stores import RocksDBStore

CAPABILITY_ID_RE = re.compile(r"^cap_[a-z0-9_]+$")


class CapabilityError(ValueError):
    pass


@dataclass(frozen=True)
class CompiledCapability:
    capability_id: str
    dependencies: dict[str, Any]
    tools: dict[str, Any]
    skill: dict[str, Any]
    harness: dict[str, Any]     # execution boundary INSIDE the capability — not a layer
    inputs: dict[str, Any]
    outputs: dict[str, Any]
    permissions: dict[str, bool]
    validation: dict[str, Any]
    provenance: dict[str, Any]
    created_at: str

    def to_dict(self) -> dict:
        return {
            "capability_id": self.capability_id,
            "dependencies": self.dependencies,
            "tools": self.tools,
            "skill": self.skill,
            "harness": self.harness,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "permissions": self.permissions,
            "validation": self.validation,
            "provenance": self.provenance,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CompiledCapability":
        return cls(
            capability_id=d["capability_id"],
            dependencies=d.get("dependencies", {}),
            tools=d.get("tools", {}),
            skill=d.get("skill", {}),
            harness=d.get("harness", {}),
            inputs=d.get("inputs", {}),
            outputs=d.get("outputs", {}),
            permissions=d.get("permissions", {}),
            validation=d.get("validation", {}),
            provenance=d.get("provenance", {}),
            created_at=d.get("created_at", ""),
        )


def _validate_structure(
    capability_id: str,
    tools: dict,
    skill: dict,
    harness: dict,
    dependencies: dict,
    inputs: dict,
    outputs: dict,
    permissions: dict,
    provenance: dict,
) -> list[str]:
    errors: list[str] = []
    if not CAPABILITY_ID_RE.match(capability_id):
        errors.append("capability_id must match cap_<lowercase_ids> (e.g. cap_pdf_semantic_extractor_v1)")
    if not skill:
        errors.append("skill section must not be empty")
    if "entrypoint" not in harness:
        errors.append("harness (execution boundary) must declare an entrypoint")
    if not isinstance(dependencies, dict):
        errors.append("dependencies must be an object")
    if not isinstance(tools, dict):
        errors.append("tools must be an object (what the capability can use/do)")
    if not isinstance(inputs, dict) or not isinstance(outputs, dict):
        errors.append("inputs and outputs must be objects")
    if not all(isinstance(v, bool) for v in permissions.values()):
        errors.append("permissions must map names to booleans")
    if "forged_id" not in provenance or "skill_id" not in provenance:
        errors.append("provenance must include forged_id and skill_id")
    for dep, ref in (dependencies or {}).items():
        if isinstance(ref, str) and ref.startswith(VENDOR_URI_SCHEME):
            continue  # vendor metadata reference — allowed, weights stay vendor-side
        if not isinstance(ref, (str, dict)):
            errors.append(f"dependency {dep!r} must be a string, object, or vendor:// URI")
    return errors


class CapabilityCompiler:
    """Compiles Tools + Harness (+ skill, dependencies) into a loadable capability."""

    def __init__(self, vault: Path, skills_store: Optional[RocksDBStore] = None):
        self.vault = Path(vault)
        self.caps_dir = self.vault / "forge" / CAPABILITIES_DIRNAME
        self.skills_store = skills_store

    def compile_capability(
        self,
        capability_id: str,
        skill_id: str,
        forged_id: str,
        harness: dict[str, Any],
        tools: Optional[dict[str, Any]] = None,
        dependencies: Optional[dict[str, Any]] = None,
        inputs: Optional[dict[str, Any]] = None,
        outputs: Optional[dict[str, Any]] = None,
        permissions: Optional[dict[str, bool]] = None,
    ) -> CompiledCapability:
        # Skill must exist in the control plane — provenance is a real binding.
        skill_record: Optional[dict] = None
        if self.skills_store is not None:
            skill_record = self.skills_store.get_value(skill_key(skill_id))
        if skill_record is None:
            raise CapabilityError(
                f"skill {skill_id!r} not found in RocksDB control plane — "
                "compile from a forged skill, not an arbitrary document"
            )

        skill_section = {
            "skill_id": skill_id,
            "skill_key": skill_key(skill_id),
            "content": skill_record,
        }
        provenance = {
            "forged_id": forged_id,
            "skill_id": skill_id,
            "skill_key": skill_key(skill_id),
            "spec_version": SPEC_VERSION,
            "belongs_to": "exoskeleton",
            "compiled_at": datetime.now(timezone.utc).isoformat(),
        }

        checks = _validate_structure(
            capability_id, tools or {}, skill_section, harness, dependencies or {},
            inputs or {}, outputs or {}, permissions or {}, provenance,
        )
        validation = {
            "structure": "pass" if not checks else "fail",
            "errors": checks,
            "skill_binding": "pass" if skill_record is not None else "fail",
            "equation": "capability = tools + harness",
        }
        if checks:
            raise CapabilityError("capability validation failed: " + "; ".join(checks))

        cap = CompiledCapability(
            capability_id=capability_id,
            dependencies=dict(dependencies or {}),
            tools=dict(tools or {}),
            skill=skill_section,
            harness=dict(harness),
            inputs=dict(inputs or {}),
            outputs=dict(outputs or {}),
            # Safety default: a capability never executes unless explicitly granted.
            permissions=dict(permissions) if permissions else {"execute": False},
            validation=validation,
            provenance=provenance,
            created_at=provenance["compiled_at"],
        )

        out = self.caps_dir / f"{capability_id}{CAP_SUFFIX}"
        if out.exists():
            raise FileExistsError(
                f"immutability: {capability_id} already compiled — compile a new version instead"
            )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(cap.to_dict(), indent=2, ensure_ascii=False))

        if self.skills_store is not None:
            self.skills_store.put_value(capability_key(capability_id), {
                "capability_id": capability_id,
                "path": str(out),
                "skill_id": skill_id,
                "forged_id": forged_id,
            })
        return cap

    def load_capability(self, capability_id: str) -> Optional[CompiledCapability]:
        """Runtime load path: control-plane pointer → immutable artifact."""
        path: Optional[str] = None
        if self.skills_store is not None:
            record = self.skills_store.get_value(capability_key(capability_id))
            if record:
                path = record.get("path")
        if path is None:
            candidate = self.caps_dir / f"{capability_id}{CAP_SUFFIX}"
            path = str(candidate) if candidate.exists() else None
        if path is None or not Path(path).exists():
            return None
        return CompiledCapability.from_dict(json.loads(Path(path).read_text()))

    def list_capabilities(self) -> list[dict]:
        out = []
        if self.caps_dir.exists():
            for f in sorted(self.caps_dir.glob(f"*{CAP_SUFFIX}")):
                d = json.loads(f.read_text())
                out.append({
                    "capability_id": d["capability_id"],
                    "tools_count": len(d.get("tools", {})),
                    "skill_id": d.get("provenance", {}).get("skill_id"),
                    "forged_id": d.get("provenance", {}).get("forged_id"),
                    "created_at": d.get("created_at"),
                })
        return out


__all__ = ["CapabilityCompiler", "CompiledCapability", "CapabilityError", "CAPABILITY_ID_RE"]
