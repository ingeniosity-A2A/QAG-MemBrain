from __future__ import annotations

from a2a.schemas.revike import RevIkeRequest, RevIkeResponse
from orchestration.memory_router import MemoryRouter, RoutedMemoryQuery


class RevIkeRuntime:
    def __init__(self, memory_router: MemoryRouter) -> None:
        self._memory_router = memory_router

    def route_context(self, operational_context: str) -> RoutedMemoryQuery:
        return self._memory_router.route_revike_query(
            operational_context,
            themes=("limitation", "delay", "belief", "authority", "stress"),
        )

    def handle(self, request: RevIkeRequest) -> RevIkeResponse:
        request.validate()
        routed = self.route_context(request.operational_context)
        context = routed.context.as_prompt_context()
        directive = self._directive_for_mood(request.current_mood_flag)

        return RevIkeResponse(
            philosophical_diagnosis=(
                f"Operational block reframed as: {routed.transformed_query}. "
                f"Context particles: {len(routed.context.particles)}."
            ),
            strategic_advice=context or "Assert the desired outcome as already actionable, then remove the smallest blocker.",
            tactical_directive=directive,
        )

    @staticmethod
    def _directive_for_mood(mood: str) -> str:
        normalized = mood.strip().lower()
        if normalized in {"high_stress", "stress", "urgent"}:
            return "pause escalation, isolate one executable next action, then delegate to Goose"
        if normalized in {"blocked", "delayed"}:
            return "convert delay into a bounded task and assign a single owner"
        return "proceed with structured delegation"
