"""F1 Chunking — GSAP Split Text structural chunker (unembedded, reversible)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

ChunkKind = Literal["heading", "paragraph", "table", "code", "list"]

HEADING_RE = re.compile(r"^#{1,6}\s")
LIST_RE = re.compile(r"^(?:[-*+]\s|\d+[.)]\s)")
BLANK_RUN_RE = re.compile(r"\n[ \t]*(?:\n[ \t]*)+")

# Three colors only — neutral / orange / yellow (docs/FORGED_FILE_STANDARD.md §1).
PALETTE_EVENTS: tuple[str, ...] = ("neutral", "orange", "yellow")


@dataclass(frozen=True)
class TextChunk:
    """An F1 chunk: structural unit with verbatim source offsets.

    ``sep_after`` is the verbatim whitespace run following this chunk ("" for the
    final chunk). Concatenating ``text + sep_after`` over all chunks reproduces
    the source exactly — that is governance rule 3 (reversibility).
    """

    doc_id: str
    chunk_index: int
    start_offset: int
    end_offset: int
    kind: ChunkKind
    text: str
    sep_after: str = ""

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "chunk_index": self.chunk_index,
            "start_offset": self.start_offset,
            "end_offset": self.end_offset,
            "kind": self.kind,
            "text": self.text,
            "sep_after": self.sep_after,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TextChunk":
        return cls(
            doc_id=d["doc_id"],
            chunk_index=int(d["chunk_index"]),
            start_offset=int(d["start_offset"]),
            end_offset=int(d["end_offset"]),
            kind=d["kind"],
            text=d["text"],
            sep_after=d.get("sep_after", ""),
        )


def reconstruct(chunks: list[TextChunk]) -> str:
    """Rebuild source text from chunks (must equal F0 content — rule 3).

    Every chunk contributes text + sep_after, including the final one — a
    document ending in a blank run stores that run as the last chunk's
    sep_after, and dropping it silently truncated the reconstruction.
    """
    if not chunks:
        return ""
    # Built back-to-front: reversed(out) yields text_i + sep_i in index order,
    # with the final chunk's sep_after (trailing blank run) included last.
    out = [chunks[-1].sep_after, chunks[-1].text]
    for c in reversed(chunks[:-1]):
        out.append(c.sep_after)
        out.append(c.text)
    return "".join(reversed(out))


class GSAPChunker:
    """Structural splitter. Splits by document structure, never by byte count."""

    def __init__(self, doc_id: str, visualizer: "GsapF1Visualizer | None" = None):
        self.doc_id = doc_id
        self.visualizer = visualizer

    # -- structural segmentation ------------------------------------------------
    @staticmethod
    def _kind_for(block: str) -> ChunkKind:
        first = block.lstrip().splitlines()[0] if block.strip() else ""
        if first.startswith("```"):
            return "code"
        if first.startswith("|") and first.rstrip().endswith("|"):
            return "table"
        if HEADING_RE.match(first):
            return "heading"
        if LIST_RE.match(first):
            return "list"
        return "paragraph"

    def _segments(self, text: str) -> list[tuple[ChunkKind, int, int, str, str]]:
        """Return (kind, start, end, block_text, sep_after) covering text exactly.

        Blank-line runs become ``sep_after`` of the preceding block, so the
        concatenation of (text + sep_after) reproduces the input byte-for-byte.
        Whitespace-only islands (e.g. lines of spaces between blank runs) are
        attached to the following block as a prefix so nothing is lost.
        """
        parts = BLANK_RUN_RE.split(text)  # even idx: block, odd idx: separator
        seps = BLANK_RUN_RE.findall(text)
        segments: list[tuple[ChunkKind, int, int, str, str]] = []
        pos = 0
        prefix = ""
        for i, part in enumerate(parts):
            sep = seps[i] if i < len(seps) else ""
            if part.strip() == "":
                # Whitespace-only island (or empty split artifact): carry forward.
                prefix += part + sep
                pos += len(part) + len(sep)
                continue
            start = pos
            block = prefix + part
            pos = start + len(block)
            prefix = ""
            segments.append((self._kind_for(block), start, pos, block, sep))
            pos += len(sep)
        if prefix:
            # Trailing whitespace island (blank runs at EOF): it follows the last
            # separator, so extend the last chunk's sep_after — byte order and
            # byte-for-byte reconstruction (rule 3) both hold. Standalone when
            # the document is whitespace-only.
            if segments:
                kind, start, end, block, sep = segments[-1]
                segments[-1] = (kind, start, end + len(prefix), block, sep + prefix)
            else:
                segments.append(("paragraph", 0, len(prefix), prefix, ""))
        return segments

    def chunk(self, text: str) -> list[TextChunk]:
        chunks = [
            TextChunk(self.doc_id, i, s, e, kind, block, sep)
            for i, (kind, s, e, block, sep) in enumerate(self._segments(text))
        ]
        if self.visualizer is not None:
            self.visualizer.emit_split(self.doc_id, chunks)
        return chunks

    # -- verification helpers -----------------------------------------------------
    @staticmethod
    def reversibility_error(chunks: list[TextChunk], original: str) -> str | None:
        """Governance rule 3: reconstruction must reproduce F0 content exactly."""
        if not chunks:
            return "no chunks"
        if [c.chunk_index for c in chunks] != list(range(len(chunks))):
            return "chunk_index not contiguous"
        return None if reconstruct(chunks) == original else "reconstruction mismatch"

    @staticmethod
    def offsets_within(chunks: list[TextChunk], length: int) -> str | None:
        for c in chunks:
            if not (0 <= c.start_offset < c.end_offset <= length):
                return f"chunk {c.chunk_index} offsets out of bounds"
        return None


class GsapF1Visualizer:
    """Emits F1 visual-language events (three colors only). Never mutates data.

    Consumer wiring into BENTO is DEV-locked (docs/FORGED_FILE_STANDARD.md §4).
    """

    def __init__(self) -> None:
        self.events: list[dict] = []

    def emit_split(self, doc_id: str, chunks: list[TextChunk]) -> None:
        for chunk in chunks:
            self.events.append({
                "color": self._color_for(chunk.kind),
                "chunk_index": chunk.chunk_index,
                "doc_id": doc_id,
                "kind": chunk.kind,
            })

    @staticmethod
    def _color_for(kind: ChunkKind) -> str:
        if kind == "heading":
            return "orange"
        if kind == "code":
            return "yellow"
        return "neutral"

    def palette_used(self) -> list[str]:
        return sorted({e["color"] for e in self.events})


__all__ = ["GsapF1Visualizer", "GSAPChunker", "TextChunk", "ChunkKind", "reconstruct", "PALETTE_EVENTS"]
