"""Hugging Face hub client (spec §4) — vendor boundary, stdlib only.

Hugging Face is the vendor/input boundary. This client enforces it:

- **Governable artifacts** (config/tokenizer/index JSON, small repo files) are
  downloaded and imported through VendorRegistry — outside the lifecycle.
- **Weight shards** (multi-GB LFS safetensors/bin) are NEVER downloaded. They are
  registered as remote refs verified against the Hub's LFS sha256, so the store
  stays content-addressed without holding the bytes.
- **Model cards** are curation documents: they route to F0 → F3 through the
  normal lifecycle and forge into skills + intelligence like any governed text.

Network access is optional at import time; every call raises HubError with an
explicit message when the Hub is unreachable. A token (HUGGINGFACE_TOKEN /
HF_TOKEN env var) is only required for gated or private repos.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from .detector import Verdict, detect
from .standard import VENDOR_URI_SCHEME

HUGGINGFACE_HOST = "https://huggingface.co"
MODEL_CARD_NAME = "README.md"

# Never download these — they are LFS weight blobs; register remote refs instead.
WEIGHT_SUFFIXES = (".safetensors", ".gguf", ".onnx", ".bin", ".pt", ".pth", ".h5", ".ckpt", ".msgpack")
# Small non-weight binaries worth vendoring locally (images used by the card etc.).
VENDORABLE_BINARY_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")
MAX_GOVERNABLE_BYTES = 64 * 1024 * 1024  # local vendoring cap for non-weight files


class HubError(RuntimeError):
    pass


def _token() -> str | None:
    return os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN") or None


def _request_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "forged-ai-filing-os"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HubError(f"Hugging Face request failed for {url}: {exc}") from exc


def _request_bytes(url: str, max_bytes: int = MAX_GOVERNABLE_BYTES) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "forged-ai-filing-os"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read(max_bytes + 1)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HubError(f"Hugging Face download failed for {url}: {exc}") from exc
    if len(data) > max_bytes:
        raise HubError(f"artifact exceeds governable size cap ({max_bytes} bytes): {url}")
    return data


@dataclass(frozen=True)
class HubModelInfo:
    repo_id: str
    sha: str                       # Hub revision this vendoring is pinned to
    private: bool
    gated: bool
    pipeline_tag: str
    license: str
    base_model: str
    library: str
    tags: tuple[str, ...]
    files: tuple[str, ...]
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def revision_uri(self) -> str:
        return f"{VENDOR_URI_SCHEME}revision/{self.repo_id}@{self.sha}"

    @property
    def weight_shards(self) -> tuple[str, ...]:
        return tuple(f for f in self.files if f.lower().endswith(WEIGHT_SUFFIXES))

    @property
    def governable_files(self) -> tuple[str, ...]:
        return tuple(
            f for f in self.files
            if not f.lower().endswith(WEIGHT_SUFFIXES)
            and f != ".gitattributes"
        )

    def to_dict(self) -> dict:
        return {
            "repo_id": self.repo_id,
            "revision": self.sha,
            "private": self.private,
            "gated": self.gated,
            "pipeline_tag": self.pipeline_tag,
            "license": self.license,
            "base_model": self.base_model,
            "library": self.library,
            "tags": list(self.tags),
            "files": list(self.files),
            "weight_shards": list(self.weight_shards),
            "governable_files": list(self.governable_files),
        }


def model_info(repo_id: str) -> HubModelInfo:
    """Fetch repo facts pinned to the current revision."""
    d = _request_json(f"{HUGGINGFACE_HOST}/api/models/{repo_id}")
    card = d.get("cardData") or {}
    tags = card.get("tags") or d.get("tags") or []
    return HubModelInfo(
        repo_id=d.get("modelId") or d.get("id") or repo_id,
        sha=d.get("sha", ""),
        private=bool(d.get("private")),
        gated=bool(d.get("gated")),
        pipeline_tag=d.get("pipeline_tag", ""),
        license=card.get("license", ""),
        base_model=card.get("base_model", ""),
        library=d.get("library_name") or card.get("library_name", ""),
        tags=tuple(str(t) for t in tags),
        files=tuple(s.get("rfilename", "") for s in d.get("siblings", []) if s.get("rfilename")),
        raw=d,
    )


@dataclass(frozen=True)
class RemoteRef:
    """A weight shard that stays vendor-side: verified against the Hub's LFS sha."""

    repo_id: str
    filename: str
    size: int
    lfs_sha256: str | None
    url: str

    @property
    def uri(self) -> str:
        return f"{VENDOR_URI_SCHEME}remote/{self.repo_id}/{self.filename}"

    def to_dict(self) -> dict:
        d = {
            "repo_id": self.repo_id,
            "filename": self.filename,
            "size": self.size,
            "lfs_sha256": self.lfs_sha256,
            "url": self.url,
            "uri": self.uri,
        }
        return d


def _lfs_pointer(repo_id: str, filename: str, token: str | None, revision: str) -> tuple[int, str | None]:
    """Fetch an LFS pointer file and extract (size, sha256) without the blob."""
    url = f"{HUGGINGFACE_HOST}/{repo_id}/raw/{revision}/{filename}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "forged-ai-filing-os",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read(4096).decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HubError(f"LFS pointer fetch failed for {filename}: {exc}") from exc
    size, sha = 0, None
    for line in text.splitlines():
        if line.startswith("size "):
            try:
                size = int(line.split()[1])
            except (IndexError, ValueError):
                pass
        if line.startswith("oid sha256:"):
            sha = line.split(":", 1)[1].strip()
    return size, sha


def remote_ref(repo_id: str, filename: str, revision: str | None = None) -> RemoteRef:
    """Register a weight shard as a verified remote ref — bytes stay on the Hub."""
    if not filename.lower().endswith(WEIGHT_SUFFIXES):
        raise HubError(f"remote_ref is for weight shards only, got {filename!r}")
    rev = revision or "main"
    token = _token()
    size, lfs_sha = _lfs_pointer(repo_id, filename, token, rev)
    return RemoteRef(
        repo_id=repo_id,
        filename=filename,
        size=size,
        lfs_sha256=lfs_sha,
        url=f"{HUGGINGFACE_HOST}/{repo_id}/resolve/{rev}/{filename}",
    )


def fetch_artifact(repo_id: str, filename: str, revision: str | None = None) -> tuple[bytes, Verdict]:
    """Download a governable (non-weight) artifact and run the detector on it.

    The detector verdict travels with the artifact so the vendor import stores
    header-derived facts — never a blind truncation. The repo filename is a
    declared fact and is passed to the detector for text formats.
    """
    if filename.lower().endswith(WEIGHT_SUFFIXES):
        raise HubError(
            f"refusing to download weight blob {filename!r} — use remote_ref(); "
            "weights stay vendor-side (spec §4)"
        )
    rev = revision or "main"
    token = _token()
    url = f"{HUGGINGFACE_HOST}/{repo_id}/resolve/{rev}/{filename}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "forged-ai-filing-os",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read(MAX_GOVERNABLE_BYTES + 1)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HubError(f"download failed for {filename}: {exc}") from exc
    if len(data) > MAX_GOVERNABLE_BYTES:
        raise HubError(f"{filename} exceeds governable size cap — refusing")
    return data, detect(data, filename=filename)


def vendor_repo(
    repo_id: str,
    vendor_registry,           # VendorRegistry — no import cycle at module load
    revision: str | None = None,
) -> dict[str, Any]:
    """Vendor a whole model repo at the boundary, per §4:

    - governable artifacts → local content-addressed vendor store (detector-parsed)
    - weight shards → verified remote refs (never downloaded)
    - model card → NOT vendored here; returned for F0 → F3 routing as curation doc
    """
    info = model_info(repo_id)
    rev = revision or info.sha or "main"
    resolved = rev  # resolve/<branch-or-sha>/ — HF URL semantics
    pinned = rev

    imported: list[dict] = []
    refused: list[dict] = []
    for filename in info.governable_files:
        if filename == MODEL_CARD_NAME:
            continue  # curation document → lifecycle, not vendor store
        try:
            data, verdict = fetch_artifact(repo_id, filename, resolved)
        except HubError as exc:
            refused.append({"filename": filename, "reason": str(exc)})
            continue
        if verdict.quarantine:
            refused.append({
                "filename": filename,
                "reason": f"detector verdict {verdict.kind} (parse_ok={verdict.parse_ok})",
            })
            continue
        try:
            imp = vendor_registry.import_artifact(data, repo_id, filename, verdict)
        except FileExistsError:
            refused.append({"filename": filename,
                            "reason": "already imported — vendor store is immutable"})
            continue
        imported.append(imp.to_dict())

    refs: list[dict] = []
    for filename in info.weight_shards:
        try:
            refs.append(remote_ref(repo_id, filename, pinned).to_dict())
        except HubError as exc:
            refused.append({"filename": filename, "reason": str(exc)})

    return {
        "repo_id": repo_id,
        "revision": info.sha,
        "license": info.license,
        "base_model": info.base_model,
        "pipeline_tag": info.pipeline_tag,
        "imported": imported,
        "remote_refs": refs,
        "refused": refused,
        "model_card": MODEL_CARD_NAME,          # route to F0→F3 via fetch_artifact()
        "model_card_pending_forge": True,
        "summary": {
            "imported_count": len(imported),
            "remote_ref_count": len(refs),
            "refused_count": len(refused),
            "weight_bytes_stayed_remote": sum(r["size"] for r in refs),
        },
    }


__all__ = [
    "HubError", "HubModelInfo", "RemoteRef", "model_info", "remote_ref",
    "fetch_artifact", "vendor_repo", "MODEL_CARD_NAME", "WEIGHT_SUFFIXES",
]
