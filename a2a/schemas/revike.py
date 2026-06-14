from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class RevIkeRequest:
    sender: str
    receiver: str
    intent: str
    operational_context: str
    current_mood_flag: str
    objective: str

    def validate(self) -> None:
        if self.receiver != "revike":
            raise ValueError("RevIkeRequest.receiver must be 'revike'")
        if self.intent not in {"revelation_request", "reflection_request", "motivation_request"}:
            raise ValueError("unsupported Rev.Ike intent")
        for field_name, value in asdict(self).items():
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"RevIkeRequest.{field_name} is required")

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RevIkeRequest":
        request = cls(
            sender=str(payload.get("sender", "")),
            receiver=str(payload.get("receiver", "")),
            intent=str(payload.get("intent", "")),
            operational_context=str(payload.get("operational_context", "")),
            current_mood_flag=str(payload.get("current_mood_flag", "")),
            objective=str(payload.get("objective", "")),
        )
        request.validate()
        return request

    def to_payload(self) -> dict[str, str]:
        self.validate()
        return asdict(self)


@dataclass(frozen=True)
class RevIkeResponse:
    philosophical_diagnosis: str
    strategic_advice: str
    tactical_directive: str

    def validate(self) -> None:
        for field_name, value in asdict(self).items():
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"RevIkeResponse.{field_name} is required")

    def to_payload(self) -> dict[str, str]:
        self.validate()
        return asdict(self)
