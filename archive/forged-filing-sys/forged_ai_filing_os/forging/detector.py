"""Artifact Detector (spec §4) — format identification by real header parsing.

Blind truncation ("first 5MB contains everything") is unsafe and forbidden:
sharded safetensors, GGUF, protobuf graph data, and multi-file HF repositories
mean the first bytes never contain everything needed. The detector parses the
declared header structure of each format and refuses to guess.
"""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from typing import Any

from .standard import ARTIFACT_KINDS

# safetensors: first 8 bytes little-endian u64 = header length; JSON header follows.
SAFETENSORS_HEADER_LEN_BYTES = 8

# GGUF: magic "GGUF" + u32 version + u64 tensor_count + u64 metadata_kv_count.
GGUF_MAGIC = b"GGUF"
GGUF_FIXED_PREFIX = 24

# ONNX: protobuf wire sniffing only — field-presence heuristics, not graph parsing.
ONNX_PROTOBUF_FIELDS = ((1, 0), (7, 2))  # (field_number, wire_type) presence pairs
ONNX_MIN_BYTES = 32
ONNX_MAX_HEADER_SNIFF = 64 * 1024

# BPE merge tables (merges.txt): two declared shapes —
#   GPT-2 style: every non-empty line is exactly two whitespace-delimited tokens;
#   versioned style: an optional '#version: 4.5' first line, then the same pairs.
MERGES_VERSION_PREFIX = "#version:"
MERGES_MIN_LINES = 10

# Jinja chat templates (chat_template.jinja): structured templating, parsed for
# declared control structures ({% ... %}, including the {%- / {%+ whitespace-
# control variants used by real HF chat templates) — not free-form text.
JINJA_BLOCK_PREFIX = "{%"
# elif/else continue an enclosing if-chain and take no {%- end %} of their own;
# every other opener (if/for/block/macro/filter/call) pairs with one end tag.
_JINJA_CONTROL_OPEN = re.compile(r"\{%-?\+?\s*(?:if|for|block|macro|filter|call)\b")
# endfor / endif / endblock / endmacro / … — any control block beginning with "end".
_JINJA_CONTROL_END = re.compile(r"\{%-?\+?\s*end")
JINJA_MIN_EXPRESSIONS = 2

DETECT_LIMIT = 16 * 1024 * 1024  # max bytes examined — never the whole stream

# Text artifacts have no magic bytes — identification combines the repo filename
# (a real declared fact) with a structural check on the bytes themselves.
PYTHON_SUFFIXES = (".py",)
TEXT_DOC_SUFFIXES = (".md", ".txt", ".rst")
SHELL_SUFFIXES = (".sh",)
CONFIG_TEXT_SUFFIXES = (".toml", ".cfg", ".ini", ".yaml", ".yml", ".properties")
WEB_SUFFIXES = (".js", ".mjs", ".html", ".css")
LICENSE_BASENAMES = ("license", "licence", "copying", "notice")
TEXT_SUFFIXES = PYTHON_SUFFIXES + TEXT_DOC_SUFFIXES + SHELL_SUFFIXES + CONFIG_TEXT_SUFFIXES + WEB_SUFFIXES
# Binary-ish formats with no parser yet: refuse explicitly, never blind-truncate.
UNPARSED_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".docx", ".pdf")
TEXT_MAX_LINE_BYTES = 64 * 1024  # pathological single lines are not structured text


def _text_doc(data: bytes, kind: str, suffix: str) -> Verdict:
    """Plain-text documents: UTF-8, no NULs, no pathological lines."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return Verdict(kind, False, reasons=["not valid UTF-8"])
    if "\x00" in text:
        return Verdict(kind, False, reasons=["NUL byte in text artifact"])
    if any(len(ln) > TEXT_MAX_LINE_BYTES for ln in text.splitlines()):
        return Verdict(kind, False, reasons=["pathological line length for a text document"])
    return Verdict(kind, True, declared={"suffix": suffix, "line_count": text.count("\n") + 1,
                                         "byte_length": len(data)})


def _python_source(data: bytes) -> Verdict:
    """Python source: must parse under the grammar — not merely decode as UTF-8."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return Verdict("python", False, reasons=["not valid UTF-8"])
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        return Verdict("python", False, reasons=[f"Python syntax error: {exc}"])
    return Verdict("python", True,
                   declared={"top_level_nodes": len(tree.body), "line_count": text.count("\n") + 1})


@dataclass
class Verdict:
    kind: str                       # ARTIFACT_KINDS member
    parse_ok: bool                  # declared header structure parsed successfully
    declared: dict[str, Any] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)

    @property
    def quarantine(self) -> bool:
        return self.kind == "unknown" or not self.parse_ok

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "parse_ok": self.parse_ok,
            "declared": self.declared,
            "reasons": self.reasons,
            "quarantine": self.quarantine,
        }


def _safetensors(data: bytes) -> Verdict:
    if len(data) < SAFETENSORS_HEADER_LEN_BYTES:
        return Verdict("safetensors", False,
                       reasons=["shorter than the 8-byte header length field"])
    n = int.from_bytes(data[:8], "little")
    if n <= 0 or n > len(data):
        return Verdict("safetensors", False,
                       reasons=[f"declared header length {n} exceeds stream ({len(data)} bytes)"])
    try:
        header = json.loads(data[8:8 + n])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return Verdict("safetensors", False, reasons=[f"header JSON unparseable: {exc}"])
    if not isinstance(header, dict):
        return Verdict("safetensors", False, reasons=["header is not a JSON object"])
    header.pop("__metadata__", None)
    return Verdict("safetensors", True, declared={"header_len": n, "tensors": sorted(header)})


def _gguf(data: bytes) -> Verdict:
    if len(data) < GGUF_FIXED_PREFIX:
        return Verdict("gguf", False, reasons=["shorter than the GGUF fixed prefix"])
    if data[:4] != GGUF_MAGIC:
        return Verdict("gguf", False, reasons=["magic mismatch"])
    version = int.from_bytes(data[4:8], "little")
    tensor_count = int.from_bytes(data[8:16], "little")
    kv_count = int.from_bytes(data[16:24], "little")
    declared = {"version": version, "tensor_count": tensor_count, "kv_count": kv_count}
    if version not in (1, 2, 3):
        return Verdict("gguf", False, declared=declared,
                       reasons=[f"unsupported GGUF version {version}"])
    if kv_count > 1_000_000 or tensor_count > 100_000:
        return Verdict("gguf", False, declared=declared,
                       reasons=["declared counts implausible — refusing to guess"])
    return Verdict("gguf", True, declared=declared)


def _onnx(data: bytes) -> Verdict:
    if len(data) < ONNX_MIN_BYTES:
        return Verdict("onnx", False, reasons=["too short to be an ONNX ModelProto"])
    sniff = data[: min(len(data), ONNX_MAX_HEADER_SNIFF)]
    present = 0
    for field_number, wire_type in ONNX_PROTOBUF_FIELDS:
        if _protobuf_field_present(sniff, field_number, wire_type):
            present += 1
    if present == 0:
        return Verdict("onnx", False, reasons=["no ModelProto field presence detected"])
    return Verdict("onnx", True,
                   declared={"fields_present": present,
                             "note": "wire-presence heuristic; full graph parse requires a pinned protobuf parser"})


def _protobuf_field_present(buf: bytes, field_number: int, wire_type: int) -> bool:
    """Scan protobuf tags for (field_number, wire_type) presence — heuristic only."""
    i, n = 0, len(buf)
    while i < n:
        tag = 0
        shift = 0
        while i < n:
            b = buf[i]
            i += 1
            tag |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80:
                break
            if shift > 63:
                return False
        if tag >> 3 == field_number and tag & 0x7 == wire_type:
            return True
        # Skip the field value coarsely by wire type to continue scanning.
        w = tag & 0x7
        if w == 0:  # varint
            while i < n and buf[i] & 0x80:
                i += 1
            i += 1
        elif w == 1:  # 64-bit
            i += 8
        elif w == 2:  # length-delimited
            ln = 0
            shift = 0
            while i < n:
                b = buf[i]
                i += 1
                ln |= (b & 0x7F) << shift
                shift += 7
                if not b & 0x80:
                    break
                if shift > 63:
                    return False
            i += ln
        elif w == 5:  # 32-bit
            i += 4
        else:
            return False
    return False


def _tokenizer_config(data: bytes) -> Verdict:
    try:
        doc = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return Verdict("tokenizer_config", False, reasons=[f"not valid JSON: {exc}"])
    if not isinstance(doc, dict):
        return Verdict("tokenizer_config", False, reasons=["JSON document is not an object"])
    return Verdict("tokenizer_config", True, declared={"keys": sorted(doc)[:64]})


def _merges(data: bytes) -> Verdict:
    """BPE merge table: optional '#version:' header + two-column token pairs.

    GPT-2 style tables omit the header — the declared structure is the pair
    invariant itself, so a headerless table with uniform pairs parses.
    """
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return Verdict("merges", False, reasons=["not valid UTF-8"])
    lines = text.splitlines()
    version: str | None = None
    if lines and lines[0].startswith(MERGES_VERSION_PREFIX):
        version = lines[0][len(MERGES_VERSION_PREFIX):].strip()
        pair_lines = lines[1:]
    else:
        pair_lines = lines
    pair_lines = [ln for ln in pair_lines if ln.strip()]
    if len(pair_lines) < MERGES_MIN_LINES:
        return Verdict("merges", False,
                       reasons=[f"only {len(pair_lines)} merge lines (min {MERGES_MIN_LINES})"])
    malformed = sum(1 for ln in pair_lines if len(ln.split()) != 2)
    if malformed:
        return Verdict("merges", False,
                       reasons=[f"{malformed} lines are not two-column token pairs"])
    declared = {"merge_count": len(pair_lines)}
    if version is not None:
        declared["version"] = version
    return Verdict("merges", True, declared=declared)


def _chat_template(data: bytes) -> Verdict:
    """Jinja chat template: structured templating with {% %} control blocks."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return Verdict("chat_template", False, reasons=["not valid UTF-8"])
    blocks = text.count(JINJA_BLOCK_PREFIX)
    if blocks < JINJA_MIN_EXPRESSIONS:
        return Verdict("chat_template", False,
                       reasons=[f"only {blocks} '{{%' blocks (min {JINJA_MIN_EXPRESSIONS})"])
    # Balanced control structure: every {%- if/for %} has a matching {%- end %}.
    opens = len(_JINJA_CONTROL_OPEN.findall(text))
    ends = len(_JINJA_CONTROL_END.findall(text))
    if opens != ends:
        return Verdict("chat_template", False,
                       reasons=[f"unbalanced control blocks: {opens} open vs {ends} end"])
    return Verdict("chat_template", True,
                   declared={"block_count": blocks, "control_pairs": opens,
                             "byte_length": len(data)})


_PARSERS = {
    "safetensors": _safetensors,
    "gguf": _gguf,
    "onnx": _onnx,
    "tokenizer_config": _tokenizer_config,
    "merges": _merges,
    "chat_template": _chat_template,
}


def detect(data: bytes, filename: str | None = None) -> Verdict:
    """Identify the artifact by parsing its declared header structure.

    Order matters: cheap magic checks first, then structural verification.
    Never reads more than DETECT_LIMIT bytes. Unknown → quarantine.

    ``filename`` is a declared fact from the repo itself — required for text
    formats (no magic bytes), optional for binary formats.
    """
    sample = data[:DETECT_LIMIT]
    for kind in ("safetensors", "gguf", "tokenizer_config", "merges", "chat_template"):
        v = _PARSERS[kind](sample)
        if v.parse_ok:
            return v
    v = _PARSERS["onnx"](sample)
    if v.parse_ok:
        return v

    # Text formats: identified by filename (declared by the repo) + structure.
    if filename:
        name = filename.lower()
        base = name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        suffix = "." + name.rsplit(".", 1)[-1] if "." in name else ""
        if name.endswith(PYTHON_SUFFIXES):
            return _python_source(sample)
        if name.endswith(TEXT_DOC_SUFFIXES) or base in LICENSE_BASENAMES:
            return _text_doc(sample, "text_document", suffix)
        if name.endswith(SHELL_SUFFIXES):
            return _text_doc(sample, "shell_script", suffix)
        if name.endswith(CONFIG_TEXT_SUFFIXES):
            return _text_doc(sample, "text_config", suffix)
        if name.endswith(WEB_SUFFIXES):
            return _text_doc(sample, "web_asset_source", suffix)
        if name.endswith(UNPARSED_SUFFIXES):
            return Verdict("unknown", False,
                           reasons=[f"binary format {suffix} has no parser — refusing, not truncating"])

    return Verdict("unknown", False,
                   reasons=["no format signature or declared header structure recognized"])


__all__ = ["Verdict", "detect", "DETECT_LIMIT", "ARTIFACT_KINDS"]
