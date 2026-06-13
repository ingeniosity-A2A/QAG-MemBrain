from __future__ import annotations

from dataclasses import dataclass, field
from time import time
from typing import Any
from uuid import uuid4

from .memory_policy import MemoryPolicy


@dataclass(frozen=True)
class MemoryParticle:
    id: str
    content: str
    primary_theme: str
    source: str
    timestamp_start: float | None = None
    timestamp_end: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time)


@dataclass(frozen=True)
class TaskMemoryContext:
    query: str
    particles: tuple[MemoryParticle, ...]

    def as_prompt_context(self) -> str:
        return "\n\n".join(
            f"[{particle.primary_theme}] {particle.content}" for particle in self.particles
        )


class TaskMemoryManager:
    def __init__(self, policy: MemoryPolicy | None = None) -> None:
        self._policy = policy or MemoryPolicy()
        self._particles: dict[str, MemoryParticle] = {}

    def create(
        self,
        content: str,
        *,
        primary_theme: str,
        source: str,
        timestamp_start: float | None = None,
        timestamp_end: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryParticle:
        self._policy.validate_chunk(content)
        particle = MemoryParticle(
            id=str(uuid4()),
            content=content,
            primary_theme=primary_theme.strip().lower(),
            source=source,
            timestamp_start=timestamp_start,
            timestamp_end=timestamp_end,
            metadata=metadata or {},
        )
        self._particles[particle.id] = particle
        return particle

    def read(self, particle_id: str) -> MemoryParticle | None:
        return self._particles.get(particle_id)

    def list(self) -> tuple[MemoryParticle, ...]:
        return tuple(self._particles.values())

    def search(self, query: str, *, themes: tuple[str, ...] = ()) -> TaskMemoryContext:
        normalized_query = query.lower()
        normalized_themes = self._policy.filter_themes(themes)
        scored: list[tuple[int, MemoryParticle]] = []

        for particle in self._particles.values():
            if normalized_themes and particle.primary_theme not in normalized_themes:
                continue

            score = 0
            if particle.primary_theme in normalized_query:
                score += 5
            for token in normalized_query.split():
                if token in particle.content.lower():
                    score += 1
            if score > 0 or normalized_themes:
                scored.append((score, particle))

        scored.sort(key=lambda item: (item[0], item[1].created_at), reverse=True)
        return TaskMemoryContext(
            query=query,
            particles=tuple(particle for _, particle in scored[: self._policy.max_context_chunks]),
        )
