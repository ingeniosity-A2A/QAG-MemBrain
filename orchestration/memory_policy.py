from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class MemoryPolicy:
    max_chunk_chars: int = 1200
    min_chunk_chars: int = 1
    max_context_chunks: int = 5
    allowed_importance: tuple[str, ...] = ("medium", "high", "critical")

    def validate_chunk(self, content: str) -> None:
        if len(content) < self.min_chunk_chars:
            raise ValueError("memory chunk is empty")
        if len(content) > self.max_chunk_chars:
            raise ValueError(f"memory chunk exceeds {self.max_chunk_chars} characters")

    def filter_themes(self, themes: Iterable[str]) -> tuple[str, ...]:
        return tuple(theme.strip().lower() for theme in themes if theme.strip())
