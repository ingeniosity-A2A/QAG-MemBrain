from __future__ import annotations

from dataclasses import asdict, dataclass, field
from time import time


@dataclass(frozen=True)
class TimelineCoordinate:
    session_id: str
    time_scale: float
    coordinate: float
    seed: str
    directive: str
    created_at: float

    def to_payload(self) -> dict[str, float | str]:
        return asdict(self)


@dataclass
class TimelineBridge:
    _coordinates: dict[str, list[TimelineCoordinate]] = field(default_factory=dict)
    _time_scales: dict[str, float] = field(default_factory=dict)

    def set_time_scale(self, session_id: str, value: float) -> float:
        if value < 0.5 or value > 2.5:
            raise ValueError("time_scale must be between 0.5 and 2.5")
        self._time_scales[session_id] = value
        return value

    def scrub_to_revelation(self, session_id: str, *, directive: str, seed: str) -> TimelineCoordinate:
        scale = self._time_scales.get(session_id, 1.0)
        coordinate = time() * scale
        event = TimelineCoordinate(
            session_id=session_id,
            time_scale=scale,
            coordinate=coordinate,
            seed=seed,
            directive=directive,
            created_at=time(),
        )
        self._coordinates.setdefault(session_id, []).append(event)
        return event

    def recent(self, session_id: str, limit: int = 10) -> tuple[TimelineCoordinate, ...]:
        return tuple(self._coordinates.get(session_id, [])[-limit:])
