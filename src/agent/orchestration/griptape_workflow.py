from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from a2a.handlers.revike_handler import handle_revike_payload
from agents.revike.runtime import RevIkeRuntime
from orchestration.memory_router import RoutedMemoryQuery


@dataclass(frozen=True)
class WorkflowStepResult:
    name: str
    output: dict[str, Any]


@dataclass(frozen=True)
class RevIkeWorkflowResult:
    steps: tuple[WorkflowStepResult, ...]
    revelation: dict[str, str]


class RevIkeGriptapeWorkflow:
    """Deterministic workflow harness for the Ava007 -> Rev.Ike A2A handshake.

    The concrete A2A schema remains authoritative. Griptape can wrap this class
    as activities/tasks without changing payload shape.
    """

    def __init__(self, runtime: RevIkeRuntime) -> None:
        self._runtime = runtime

    def run(self, payload: dict[str, Any]) -> RevIkeWorkflowResult:
        transformed = self._runtime.route_context(str(payload.get("operational_context", "")))
        revelation = handle_revike_payload(payload, self._runtime)
        return RevIkeWorkflowResult(
            steps=(
                WorkflowStepResult("query_transform", _route_to_payload(transformed)),
                WorkflowStepResult("a2a_revelation", revelation),
            ),
            revelation=revelation,
        )


def _route_to_payload(route: RoutedMemoryQuery) -> dict[str, Any]:
    return {
        "raw_query": route.raw_query,
        "transformed_query": route.transformed_query,
        "particle_ids": [particle.id for particle in route.context.particles],
    }
