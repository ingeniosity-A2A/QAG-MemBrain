"""
Ava007 Adapter — connects QAG-MemBrain Rev.Ike runtime to Ava007's Python Rev.Ike.

Adds mood state, bias vectors, intuition signals, and philosophical layer
to the existing RevIkeRuntime responses.

Imports Ava007's RevIkeBridge directly (same filesystem).
Respects the Dual Consciousness Contract:
- Rev.Ike reads, interprets, proposes
- AVA decides
"""
from __future__ import annotations

import sys
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Optional

# Add Ava007 to path for direct import
AVA007_ROOT = Path(__file__).resolve().parents[4] / "Ava007"
if str(AVA007_ROOT) not in sys.path:
    sys.path.insert(0, str(AVA007_ROOT))

try:
    from runtime.intellect.core.subconscious.rev_ike_bridge import RevIkeBridge
    BRIDGE_AVAILABLE = True
except ImportError:
    BRIDGE_AVAILABLE = False


@dataclass
class EnhancedResponse:
    """Response with Ava007 Rev.Ike enrichment."""
    philosophical_diagnosis: str
    strategic_advice: str
    tactical_directive: str
    mood_state: Optional[str] = None
    mood_bias: Optional[list] = None
    intuition_signals: Optional[list] = None
    wellness: Optional[float] = None
    anomaly: bool = False


class Ava007Adapter:
    """
    Adapter between QAG-MemBrain Rev.Ike and Ava007's Python Rev.Ike.

    Usage:
        adapter = Ava007Adapter()
        enhanced = adapter.enhance(
            base_diagnosis="...",
            base_advice="...",
            base_directive="...",
            operational_context="...",
            current_mood_flag="normal"
        )
    """

    def __init__(self, storage_path=None):
        self._bridge = None
        self._available = BRIDGE_AVAILABLE
        if BRIDGE_AVAILABLE:
            try:
                sp = storage_path or str(
                    Path(__file__).resolve().parents[3] / "cache" / "rev_ike_bridge.json"
                )
                self._bridge = RevIkeBridge(storage_path=sp)
            except Exception:
                self._available = False

    @property
    def available(self) -> bool:
        return self._available and self._bridge is not None

    def enhance(self, base_diagnosis, base_advice, base_directive,
                operational_context, current_mood_flag="normal",
                intent="reflection_request", sender="ava007"):
        """
        Enhance a base RevIkeResponse with Ava007 Rev.Ike state.

        If Ava007 bridge is unavailable, returns the base response unchanged.
        """
        if not self.available:
            return EnhancedResponse(
                philosophical_diagnosis=base_diagnosis,
                strategic_advice=base_advice,
                tactical_directive=base_directive,
            )

        # Get A2A response from Ava007 bridge
        a2a_response = self._bridge.handle_a2a_request(
            sender=sender,
            intent=intent,
            operational_context=operational_context,
            current_mood_flag=current_mood_flag,
        )

        # Merge: QAG memory context + Ava007 philosophical layer
        merged_diagnosis = base_diagnosis
        if a2a_response.philosophical_diagnosis:
            merged_diagnosis = (
                base_diagnosis + " | Rev.Ike: "
                + a2a_response.philosophical_diagnosis
            )

        # Use Ava007 advice if base is generic
        merged_advice = base_advice
        if (a2a_response.strategic_advice
                and "smallest blocker" in base_advice):
            merged_advice = a2a_response.strategic_advice

        # Use Ava007 directive based on mood
        merged_directive = base_directive
        if a2a_response.tactical_directive:
            mood = self._bridge.rev_ike.mood
            if mood.urgency > 0.7 or mood.fatigue > 0.7:
                merged_directive = a2a_response.tactical_directive

        return EnhancedResponse(
            philosophical_diagnosis=merged_diagnosis,
            strategic_advice=merged_advice,
            tactical_directive=merged_directive,
            mood_state=self._bridge.rev_ike.mood.describe(),
            mood_bias=a2a_response.mood_bias,
            intuition_signals=a2a_response.intuition_signals,
            wellness=self._bridge.rev_ike.mood.overall_wellness(),
            anomaly=a2a_response.anomaly,
        )

    def process_memory_atom(self, atom_id, atom_type, atom_title,
                            atom_content, atom_confidence=0.5,
                            atom_tags=None, atom_source="unknown"):
        """
        Process a memory atom through Ava007 Rev.Ike.
        Returns an ObservationProposal in QAG contract format.
        """
        if not self.available:
            return None
        return self._bridge.process_atom(
            atom_id=atom_id, atom_type=atom_type,
            atom_title=atom_title, atom_content=atom_content,
            atom_tags=atom_tags, atom_source=atom_source,
            atom_confidence=atom_confidence,
        )

    def dream(self):
        if not self.available:
            return {"error": "Bridge not available"}
        return self._bridge.dream()

    def how_do_you_feel(self):
        if not self.available:
            return "Rev.Ike bridge not connected"
        return self._bridge.how_do_you_feel()

    def get_stats(self):
        if not self.available:
            return {"available": False, "reason": "Bridge not connected"}
        stats = self._bridge.get_stats()
        stats["available"] = True
        stats["adapter"] = "qag_membrain_to_ava007"
        return stats
