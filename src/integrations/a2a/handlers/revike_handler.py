from __future__ import annotations

from typing import Any

from a2a.schemas.revike import RevIkeRequest
from agents.revike.runtime import RevIkeRuntime


def handle_revike_payload(payload: dict[str, Any], runtime: RevIkeRuntime) -> dict[str, str]:
    request = RevIkeRequest.from_payload(payload)
    return runtime.handle(request).to_payload()
