from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class ToolExecutionResult:
    status: str
    tool: str
    result: dict[str, str]


class ToolDispatcher:
    def __init__(self) -> None:
        self._tools: dict[str, Callable[[dict[str, str]], dict[str, str]]] = {}

    def register(self, name: str, handler: Callable[[dict[str, str]], dict[str, str]]) -> None:
        self._tools[name] = handler

    def dispatch(self, name: str, payload: dict[str, str]) -> ToolExecutionResult:
        handler = self._tools.get(name)
        if not handler:
            return ToolExecutionResult(
                status="error",
                tool=name,
                result={"error": f"tool '{name}' is not registered"},
            )

        return ToolExecutionResult(status="ok", tool=name, result=handler(payload))
