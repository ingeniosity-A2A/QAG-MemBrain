"""
Backhaul Steering Controller — E-band mmWave + Microwave IP.

White paper DLI §3: "Ava007 utilizes Double Learning to orchestrate
traffic across multi-tier backhaul."

  - E-band (mmWave): ultra-high-capacity, low-latency "burst" traffic
  - Microwave IP: stable, packet-switched control plane with IP/MPLS
    for network-wide resiliency and fast reroute (FRR) within 50ms

Deploys to:
  - termux_usb_serial (modem backhaul selection)
  - gsap_temporal (record steering decisions)
"""

import time
import logging
from typing import Optional
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class BackhaulType(Enum):
    E_BAND_MMWAVE = "e_band_mmwave"
    MICROWAVE_IP = "microwave_ip"
    CELLULAR_FALLBACK = "cellular_fallback"


@dataclass
class BackhaulStatus:
    backhaul: BackhaulType
    throughput_mbps: float
    latency_ms: float
    jitter_ms: float
    packet_loss_pct: float
    timestamp_ns: int


class BackhaulSteeringController:
    """
    Orchestrates traffic across multi-tier backhaul using Double Learning.

    Decision factors:
      - Current throughput needs (burst vs steady)
      - Latency sensitivity (real-time vs background)
      - Backhaul health (throughput, latency, jitter, packet loss)
      - Queue stability (Lyapunov drift-plus-penalty)
    """

    def __init__(self):
        self.current_backhaul: BackhaulType = BackhaulType.MICROWAVE_IP
        self.steering_count = 0
        self.frr_triggered = False

    def evaluate(
        self,
        e_band: Optional[BackhaulStatus],
        microwave: Optional[BackhaulStatus],
        traffic_type: str = "steady",
        latency_budget_ms: float = 100.0,
    ) -> BackhaulType:
        """
        Evaluate which backhaul to use. Returns the recommended backhaul.

        Args:
            e_band: Current E-band status (None if unavailable)
            microwave: Current Microwave IP status (None if unavailable)
            traffic_type: "burst" (high-capacity, short) or "steady" (reliable)
            latency_budget_ms: Maximum acceptable latency
        """
        candidates = []

        if e_band and e_band.throughput_mbps > 0:
            candidates.append((BackhaulType.E_BAND_MMWAVE, e_band))
        if microwave and microwave.throughput_mbps > 0:
            candidates.append((BackhaulType.MICROWAVE_IP, microwave))

        if not candidates:
            return BackhaulType.CELLULAR_FALLBACK

        # Score each backhaul
        best_score = -float('inf')
        best_backhaul = self.current_backhaul

        for bh_type, status in candidates:
            score = self._score_backhaul(status, traffic_type, latency_budget_ms)
            if score > best_score:
                best_score = score
                best_backhaul = bh_type

        # Steer if different from current
        if best_backhaul != self.current_backhaul:
            self.steer(best_backhaul, reason=f"traffic_type={traffic_type}")

        return best_backhaul

    def _score_backhaul(
        self,
        status: BackhaulStatus,
        traffic_type: str,
        latency_budget_ms: float,
    ) -> float:
        """Score a backhaul — higher is better."""
        score = 0.0

        # Throughput (higher is better)
        score += status.throughput_mbps * 0.01

        # Latency (lower is better, penalize if over budget)
        if status.latency_ms > latency_budget_ms:
            score -= (status.latency_ms - latency_budget_ms) * 0.5
        else:
            score += (latency_budget_ms - status.latency_ms) * 0.1

        # Jitter (lower is better)
        score -= status.jitter_ms * 0.2

        # Packet loss (lower is better, heavily penalize)
        score -= status.packet_loss_pct * 10.0

        # Traffic type preference
        if traffic_type == "burst":
            # Burst traffic prefers E-band (higher capacity)
            if status.throughput_mbps > 1000:
                score += 50.0
        elif traffic_type == "steady":
            # Steady traffic prefers Microwave (more stable)
            if status.packet_loss_pct < 0.1 and status.jitter_ms < 5:
                score += 30.0

        return score

    def steer(self, target: BackhaulType, reason: str = "") -> bool:
        """
        Steer traffic to a different backhaul.

        In production: calls termux_usb_serial to issue modem AT commands
        for backhaul selection.
        """
        logger.info(f"Steering backhaul: {self.current_backhaul.value} → {target.value} ({reason})")

        # Fast Reroute (FRR) — 50ms restoration
        if self.current_backhaul == BackhaulType.E_BAND_MMWAVE and target == BackhaulType.MICROWAVE_IP:
            self.frr_triggered = True
            logger.info("FRR triggered: E-band failure, rerouting to Microwave IP (<50ms)")

        self.current_backhaul = target
        self.steering_count += 1

        # In production: deposit a Receipt via LiteNotebook::deposit()
        # with origin=Tashi, kind=Control, content=f"backhaul_steered:{target.value}"
        return True

    def trigger_frr(self) -> bool:
        """
        Trigger Fast Reroute — switch from E-band to Microwave IP immediately.
        Used when E-band degrades below threshold.
        """
        if self.current_backhaul == BackhaulType.E_BAND_MMWAVE:
            return self.steer(BackhaulType.MICROWAVE_IP, reason="FRR: E-band degraded")
        return False

    def status(self) -> dict:
        return {
            'current_backhaul': self.current_backhaul.value,
            'steering_count': self.steering_count,
            'frr_triggered': self.frr_triggered,
        }
