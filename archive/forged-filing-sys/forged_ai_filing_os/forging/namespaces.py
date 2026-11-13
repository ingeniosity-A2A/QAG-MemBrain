"""RocksDB control-plane namespaces (spec §5).

RocksDB stores the control plane; the renderer owns the actual GPU/CPU asset
lifecycle. Keys are namespaced — never one giant composite string.
"""

from __future__ import annotations

from typing import Any, Optional

from .standard import NAMESPACE_SCHEMA, VENDOR_URI_SCHEME


class NamespaceError(ValueError):
    pass


def skill_key(skill_id: str) -> str:
    return f"skill:{skill_id}"


def capability_key(capability_id: str) -> str:
    return f"capability:{capability_id}"


def asset_key(asset_id: str) -> str:
    return f"asset:{asset_id}"


def layer_key(stack_id: str, layer_id: str) -> str:
    return f"layer:{stack_id}:{layer_id}"


def idx_hash_key(content_hash: str) -> str:
    return f"idx:hash:{content_hash}"


def idx_asset_key(asset_id: str) -> str:
    return f"idx:asset:{asset_id}"


def manifest_key(forged_id: str) -> str:
    return f"manifest:{forged_id}"


def stack_key(job_id: str, frame_id: str, depth: int) -> str:
    return f"stack:{job_id}:{frame_id}:{depth}"


def parse_key(key: str) -> tuple[str, tuple[str, ...]]:
    """Parse a namespaced key back to (namespace, parts). Raises on unknown."""
    for ns in NAMESPACE_SCHEMA:
        prefix = f"{ns}:"
        if key.startswith(prefix):
            rest = key[len(prefix):]
            if not rest:
                raise NamespaceError(f"empty {ns} key")
            return ns, tuple(rest.split(":"))
    raise NamespaceError(f"key {key!r} matches no namespace in the schema")


def validate_key(key: str) -> None:
    parse_key(key)


def render_stack_value(
    asset_id: str,
    uri: str,
    type_: str = "texture",
    blend_mode: str = "normal",
    transform: Optional[dict[str, Any]] = None,
    enabled: bool = True,
) -> dict[str, Any]:
    """Value schema for stack:{job_id}:{frame_id}:{depth} (spec §5 example)."""
    if not uri.startswith(VENDOR_URI_SCHEME) and "://" not in uri:
        raise NamespaceError(f"stack asset uri must be a URI (e.g. {VENDOR_URI_SCHEME}...)")
    return {
        "asset_id": asset_id,
        "uri": uri,
        "type": type_,
        "blend_mode": blend_mode,
        "transform": transform or {},
        "enabled": enabled,
    }


__all__ = [
    "NamespaceError",
    "skill_key", "capability_key", "asset_key", "layer_key",
    "idx_hash_key", "idx_asset_key", "manifest_key", "stack_key",
    "parse_key", "validate_key", "render_stack_value",
]
