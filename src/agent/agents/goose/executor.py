from __future__ import annotations

from agents.goose.tool_dispatcher import ToolDispatcher, ToolExecutionResult


class GooseExecutor:
    def __init__(self, dispatcher: ToolDispatcher | None = None) -> None:
        self._dispatcher = dispatcher or ToolDispatcher()

    @property
    def dispatcher(self) -> ToolDispatcher:
        return self._dispatcher

    def execute_directive(self, directive: str, context: dict[str, str] | None = None) -> ToolExecutionResult:
        return self._dispatcher.dispatch("directive", {"directive": directive, **(context or {})})
