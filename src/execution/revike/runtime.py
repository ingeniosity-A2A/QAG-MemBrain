from __future__ import annotations

from a2a.schemas.revike import RevIkeRequest, RevIkeResponse
from orchestration.memory_router import MemoryRouter, RoutedMemoryQuery

try:
    from .ava007_adapter import Ava007Adapter
    ADAPTER_AVAILABLE = True
except ImportError:
    ADAPTER_AVAILABLE = False


class RevIkeRuntime:
    def __init__(self, memory_router: MemoryRouter) -> None:
        self._memory_router = memory_router
        self._adapter = Ava007Adapter() if ADAPTER_AVAILABLE else None

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

        # Base response from memory context
        base_diagnosis = (
            f"Operational block reframed as: {routed.transformed_query}. "
            f"Context particles: {len(routed.context.particles)}."
        )
        base_advice = context or (
            "Assert the desired outcome as already actionable, "
            "then remove the smallest blocker."
        )

        # Enhance with Ava007 Rev.Ike if available
        if self._adapter and self._adapter.available:
            enhanced = self._adapter.enhance(
                base_diagnosis=base_diagnosis,
                base_advice=base_advice,
                base_directive=directive,
                operational_context=request.operational_context,
                current_mood_flag=request.current_mood_flag,
                intent=request.intent,
                sender=request.sender,
            )
            return RevIkeResponse(
                philosophical_diagnosis=enhanced.philosophical_diagnosis,
                strategic_advice=enhanced.strategic_advice,
                tactical_directive=enhanced.tactical_directive,
            )

        return RevIkeResponse(
            philosophical_diagnosis=base_diagnosis,
            strategic_advice=base_advice,
            tactical_directive=directive,
        )

    def feel(self):
        if self._adapter and self._adapter.available:
            return self._adapter.how_do_you_feel()
        return "Rev.Ike adapter not connected"

    def dream(self):
        if self._adapter and self._adapter.available:
            return self._adapter.dream()
        return {"error": "Adapter not available"}

    def mood_stats(self):
        if self._adapter and self._adapter.available:
            return self._adapter.get_stats()
        return {"available": False}

    @staticmethod
    def _directive_for_mood(mood: str) -> str:
        normalized = mood.strip().lower()
        if normalized in {"high_stress", "stress", "urgent"}:
            return "pause escalation, isolate one executable next action, then delegate to Goose"
        if normalized in {"blocked", "delayed"}:
            return "convert delay into a bounded task and assign a single owner"
        return "proceed with structured delegation"
