from __future__ import annotations

from dataclasses import dataclass

from .context_filter import transform_operational_query
from .task_memory_manager import TaskMemoryContext, TaskMemoryManager


@dataclass(frozen=True)
class RoutedMemoryQuery:
    raw_query: str
    transformed_query: str
    context: TaskMemoryContext


class MemoryRouter:
    def __init__(self, task_memory: TaskMemoryManager) -> None:
        self._task_memory = task_memory

    def route_revike_query(self, raw_query: str, *, themes: tuple[str, ...] = ()) -> RoutedMemoryQuery:
        transformed = transform_operational_query(raw_query)
        context = self._task_memory.search(transformed, themes=themes)
        return RoutedMemoryQuery(
            raw_query=raw_query,
            transformed_query=transformed,
            context=context,
        )
