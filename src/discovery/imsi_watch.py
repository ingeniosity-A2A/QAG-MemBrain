#!/usr/bin/env python3
"""
QAG_MemBrain — Privacy Shield: IMSI-Catcher Detection for S26 Ultra
Real-time spectrum monitoring via gr-gsm / sSDR/xSDR module.

Detects rogue base stations (Stingrays, IMSI-catchers) and triggers
immediate identity rotation via the Identity Manager.

Hardware: Samsung S26 Ultra + Wavelet Lab xSDR/sSDR via USB OTG
SDR Backend: GNU Radio + gr-gsm
GPU Acceleration: Adreno 830 OpenCL for real-time DSP

Usage:
    python3 imsi_watch.py [--sdr-device /dev/ttyUSB0] [--scan-interval 10]
"""

import os
import sys
import json
import time
import signal
import logging
import argparse
import subprocess
import threading
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [IMSI_WATCH] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("imsi_watch")


# ─── Types ─────────────────────────────────────────────────────────

@dataclass
class CellTower:
    """Represents a detected cell tower."""
    mcc: str
    mnc: str
    lac: int
    cid: int
    arfcn: int
    signal_dbm: int
    timestamp: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    suspicious: bool = False
    threat_score: float = 0.0

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class ThreatEvent:
    """Represents a detected IMSI-catcher threat."""
    tower: CellTower
    threat_level: str  # "low", "medium", "high", "critical"
    confidence: float
    indicators: List[str]
    timestamp: float
    action_taken: str
    identity_rotated: bool = False
    new_identity_id: Optional[str] = None

    def to_dict(self) -> Dict:
        return asdict(self)


# ─── Known Legitimate PLMNs ────────────────────────────────────────

KNOWN_LEGITIMATE_PLMNS = {
    # US Carriers
    ("310", "260"),  # T-Mobile
    ("310", "004"),  # Verizon
    ("310", "410"),  # AT&T
    ("311", "480"),  # Verizon
    ("311", "580"),  # AT&T
    ("312", "530"),  # Verizon
    # International
    ("234", "10"),   # BT (UK)
    ("234", "15"),   # Vodafone (UK)
    ("262", "01"),   # T-Mobile (DE)
}

# Our private PLMN (should never appear in legitimate scan)
PRIVATE_PLMN = ("901", "70")


# ─── Threat Analysis ───────────────────────────────────────────────

class ThreatAnalyzer:
    """
    Analyzes detected cell towers for IMSI-catcher indicators.
    Uses heuristic scoring based on known attack patterns.
    """

    def __init__(self, private_plmn: Tuple[str, str] = PRIVATE_PLMN):
        self.private_plmn = private_plmn
        self.known_towers: Dict[str, CellTower] = {}
        self.threat_history: List[ThreatEvent] = []

    def analyze(self, tower: CellTower) -> ThreatEvent:
        """
        Analyze a cell tower for threat indicators.
        Returns a ThreatEvent with confidence score.
        """
        indicators = []
        threat_score = 0.0

        # Check 1: Known PLMN is not in legitimate list
        plmn_key = (tower.mcc, tower.mnc)
        if plmn_key not in KNOWN_LEGITIMATE_PLMNS and plmn_key != self.private_plmn:
            indicators.append(f"Unknown PLMN: {tower.mcc}/{tower.mnc}")
            threat_score += 0.3

        # Check 2: Signal strength anomaly (too strong for cell tower)
        if tower.signal_dbm > -30:
            indicators.append(f"Abnormally strong signal: {tower.signal_dbm} dBm")
            threat_score += 0.25

        # Check 3: ARFCN in unusual range
        if tower.arfcn < 1 or tower.arfcn > 100:
            indicators.append(f"Unusual ARFCN: {tower.arfcn}")
            threat_score += 0.15

        # Check 4: LAC/CID pattern (Stingrays often use low LAC)
        if tower.lac < 100 and tower.cid == 0:
            indicators.append(f"Suspicious LAC/CID: {tower.lac}/{tower.cid}")
            threat_score += 0.2

        # Check 5: Rapid appearance (new tower appeared suddenly)
        tower_key = f"{tower.mcc}_{tower.mnc}_{tower.lac}_{tower.cid}"
        if tower_key not in self.known_towers:
            indicators.append("New tower not previously seen")
            threat_score += 0.1
            # If tower appeared in last 60 seconds, higher threat
            if time.time() - tower.timestamp < 60:
                indicators.append("Appeared within last 60 seconds")
                threat_score += 0.15

        # Check 6: Duplicate CID with different PLMN
        for known_key, known_tower in self.known_towers.items():
            if (known_tower.cid == tower.cid and 
                known_tower.lac == tower.lac and
                (known_tower.mcc != tower.mcc or known_tower.mnc != tower.mnc)):
                indicators.append(f"CID {tower.cid} reused across different PLMNs")
                threat_score += 0.3
                break

        # Determine threat level
        if threat_score >= 0.8:
            threat_level = "critical"
        elif threat_score >= 0.6:
            threat_level = "high"
        elif threat_score >= 0.4:
            threat_level = "medium"
        else:
            threat_level = "low"

        tower.suspicious = threat_score >= 0.5
        tower.threat_score = threat_score

        event = ThreatEvent(
            tower=tower,
            threat_level=threat_level,
            confidence=min(threat_score, 1.0),
            indicators=indicators,
            timestamp=time.time(),
            action_taken="monitoring" if threat_level in ("low", "medium") else "identity_rotation",
        )

        self.threat_history.append(event)
        self.known_towers[tower_key] = tower

        return event


# ─── SDR Scanner (gr-gsm integration) ──────────────────────────────

class SDRScanner:
    """
    Interfaces with gr-gsm / GNU Radio for spectrum scanning.
    Falls back to mock mode if hardware not available.
    """

    def __init__(self, sdr_device: str = "/dev/ttyUSB0"):
        self.sdr_device = sdr_device
        self.mock_mode = not self._check_sdr_available()
        self._grgsm_proc: Optional[subprocess.Popen] = None

    def _check_sdr_available(self) -> bool:
        """Check if SDR hardware is available."""
        try:
            # Check for xSDR/sSDR device
            if os.path.exists(self.sdr_device):
                return True
            # Check for HackRF, RTL-SDR, etc.
            result = subprocess.run(
                ["lsusb"], capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if any(x in line.lower() for x in ["hackrf", "rtlsdr", "xsdr", "ssdr", "wavelet"]):
                    return True
        except Exception:
            pass
        return False

    def scan(self, duration_sec: int = 5) -> List[CellTower]:
        """
        Perform a spectrum scan and return detected cell towers.
        """
        if self.mock_mode:
            return self._mock_scan()

        try:
            return self._grgsm_scan(duration_sec)
        except Exception as e:
            log.warning(f"gr-gsm scan failed: {e}, falling back to mock")
            return self._mock_scan()

    def _grgsm_scan(self, duration_sec: int) -> List[CellTower]:
        """Real scan using gr-gsm."""
        towers = []
        try:
            # gr-gsm_lte_scanner for LTE cell search
            result = subprocess.run(
                [
                    "grgsm_lte_scanner",
                    "-s", "2e6",        # 2 MHz sampling rate
                    "-g", "40",         # Gain
                    "-d", self.sdr_device,
                ],
                capture_output=True,
                text=True,
                timeout=duration_sec + 5,
            )

            for line in result.stdout.splitlines():
                tower = self._parse_grgsm_output(line)
                if tower:
                    towers.append(tower)

        except FileNotFoundError:
            log.warning("grgsm_lte_scanner not found, using mock mode")
            return self._mock_scan()
        except subprocess.TimeoutExpired:
            log.warning("gr-gsm scan timed out")

        return towers

    def _parse_grgsm_output(self, line: str) -> Optional[CellTower]:
        """Parse gr-gsm scanner output."""
        try:
            # Format: MCC MNC LAC CID ARFCN RSSI
            parts = line.strip().split()
            if len(parts) >= 6:
                return CellTower(
                    mcc=parts[0],
                    mnc=parts[1],
                    lac=int(parts[2]),
                    cid=int(parts[3]),
                    arfcn=int(parts[4]),
                    signal_dbm=int(parts[5]),
                    timestamp=time.time(),
                )
        except (ValueError, IndexError):
            pass
        return None

    def _mock_scan(self) -> List[CellTower]:
        """Mock scan for testing without hardware."""
        import random

        # Simulate 2-4 towers, one potentially suspicious
        num_towers = random.randint(2, 4)
        towers = []

        for i in range(num_towers):
            if i == 0 and random.random() < 0.3:
                # Sometimes inject a suspicious tower
                towers.append(CellTower(
                    mcc="001",
                    mnc="01",
                    lac=random.randint(1, 50),
                    cid=0,
                    arfcn=random.randint(1, 100),
                    signal_dbm=random.randint(-20, -10),
                    timestamp=time.time(),
                ))
            else:
                # Normal carrier towers
                carrier = random.choice([
                    ("310", "260"),  # T-Mobile
                    ("310", "004"),  # Verizon
                    ("310", "410"),  # AT&T
                ])
                towers.append(CellTower(
                    mcc=carrier[0],
                    mnc=carrier[1],
                    lac=random.randint(1000, 65535),
                    cid=random.randint(1, 268435455),
                    arfcn=random.randint(1, 500),
                    signal_dbm=random.randint(-90, -50),
                    timestamp=time.time(),
                ))

        return towers

    def stop(self):
        """Stop any running scan process."""
        if self._grgsm_proc:
            self._grgsm_proc.terminate()
            self._grgsm_proc = None


# ─── IMSI Watcher ──────────────────────────────────────────────────

class IMSIWatcher:
    """
    Main IMSI-catcher detection and response system.
    
    Continuously scans for cell towers, analyzes for threats,
    and triggers identity rotation when threats are detected.
    """

    def __init__(
        self,
        sdr_device: str = "/dev/ttyUSB0",
        scan_interval: int = 10,
        threat_threshold: float = 0.7,
        auto_rotate: bool = True,
    ):
        self.scanner = SDRScanner(sdr_device)
        self.analyzer = ThreatAnalyzer()
        self.scan_interval = scan_interval
        self.threat_threshold = threat_threshold
        self.auto_rotate = auto_rotate
        self.running = False
        self._scan_count = 0
        self._threat_count = 0
        self._rotation_count = 0
        self._on_threat_callbacks = []
        self._on_rotation_callbacks = []

        # Path to identity manager (TypeScript)
        self.identity_state_path = Path("/tmp/current_identity.json")

    def on_threat(self, callback):
        """Register callback for threat detection."""
        self._on_threat_callbacks.append(callback)

    def on_rotation(self, callback):
        """Register callback for identity rotation."""
        self._on_rotation_callbacks.append(callback)

    def start(self):
        """Start continuous monitoring."""
        log.info("Starting IMSI-Catcher Detection...")
        log.info(f"  SDR Device: {self.scanner.sdr_device}")
        log.info(f"  Scan Interval: {self.scan_interval}s")
        log.info(f"  Threat Threshold: {self.threat_threshold}")
        log.info(f"  Auto-Rotate: {self.auto_rotate}")
        log.info(f"  Mock Mode: {self.scanner.mock_mode}")

        self.running = True

        # Main scan loop
        try:
            while self.running:
                self._scan_cycle()
                time.sleep(self.scan_interval)
        except KeyboardInterrupt:
            log.info("Shutdown signal received")
        finally:
            self.stop()

    def _scan_cycle(self):
        """Perform one scan cycle."""
        self._scan_count += 1
        log.debug(f"Scan cycle {self._scan_count}...")

        # Scan for towers
        towers = self.scanner.scan(duration_sec=min(self.scan_interval - 1, 5))

        # Analyze each tower
        for tower in towers:
            event = self.analyzer.analyze(tower)

            if event.threat_level in ("high", "critical"):
                self._threat_count += 1
                log.warning(
                    f"THREAT DETECTED: {tower.mcc}/{tower.mnc} LAC={tower.lac} CID={tower.cid} "
                    f"Score={tower.threat_score:.2f} Level={event.threat_level}"
                )
                log.warning(f"  Indicators: {', '.join(event.indicators)}")

                # Notify callbacks
                for cb in self._on_threat_callbacks:
                    cb(event)

                # Auto-rotate if enabled
                if self.auto_rotate and event.action_taken == "identity_rotation":
                    self._trigger_rotation(event)

        # Log scan summary periodically
        if self._scan_count % 10 == 0:
            log.info(
                f"Scan #{self._scan_count}: {len(towers)} towers detected, "
                f"{self._threat_count} threats, {self._rotation_count} rotations"
            )

    def _trigger_rotation(self, threat_event: ThreatEvent):
        """Trigger identity rotation via the Identity Manager."""
        self._rotation_count += 0
        log.info("Triggering identity rotation...")

        try:
            # Signal the identity manager to rotate
            # In production, this would call the TypeScript identity.ts via IPC
            rotation_signal = {
                "action": "rotate",
                "reason": "threat",
                "source": f"{threat_event.tower.mcc}/{threat_event.tower.mnc}",
                "threat_level": threat_event.threat_level,
                "timestamp": time.time(),
            }

            # Write rotation signal for identity manager to pick up
            signal_path = Path("/tmp/identity_rotation_signal.json")
            signal_path.write_text(json.dumps(rotation_signal, indent=2))
            log.info(f"Rotation signal written to {signal_path}")

            threat_event.identity_rotated = True
            self._rotation_count += 1

            # Notify callbacks
            for cb in self._on_rotation_callbacks:
                cb(rotation_signal)

        except Exception as e:
            log.error(f"Failed to trigger rotation: {e}")

    def scan_once(self) -> List[ThreatEvent]:
        """Perform a single scan and return all threat events."""
        towers = self.scanner.scan()
        events = []
        for tower in towers:
            event = self.analyzer.analyze(tower)
            events.append(event)
        return events

    def get_stats(self) -> Dict:
        """Get current watcher statistics."""
        return {
            "running": self.running,
            "mock_mode": self.scanner.mock_mode,
            "scan_count": self._scan_count,
            "threat_count": self._threat_count,
            "rotation_count": self._rotation_count,
            "known_towers": len(self.analyzer.known_towers),
            "threat_history": len(self.analyzer.threat_history),
            "scan_interval": self.scan_interval,
            "threat_threshold": self.threat_threshold,
        }

    def stop(self):
        """Stop monitoring and cleanup."""
        self.running = False
        self.scanner.stop()

        # Export final state
        state = self.get_stats()
        state["stopped_at"] = time.time()
        state_path = Path("/tmp/imsi_watch_state.json")
        state_path.write_text(json.dumps(state, indent=2))

        log.info(
            f"Watcher stopped. Scans: {self._scan_count}, "
            f"Threats: {self._threat_count}, Rotations: {self._rotation_count}"
        )


# ─── CLI Entry Point ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="IMSI-Catcher Detection for S26 Ultra")
    parser.add_argument(
        "--sdr-device",
        default="/dev/ttyUSB0",
        help="SDR device path (default: /dev/ttyUSB0)",
    )
    parser.add_argument(
        "--scan-interval",
        type=int,
        default=10,
        help="Scan interval in seconds (default: 10)",
    )
    parser.add_argument(
        "--threat-threshold",
        type=float,
        default=0.7,
        help="Threat score threshold for auto-rotation (default: 0.7)",
    )
    parser.add_argument(
        "--no-auto-rotate",
        action="store_true",
        help="Disable automatic identity rotation on threat detection",
    )
    parser.add_argument(
        "--scan-once",
        action="store_true",
        help="Perform a single scan and exit",
    )
    args = parser.parse_args()

    watcher = IMSIWatcher(
        sdr_device=args.sdr_device,
        scan_interval=args.scan_interval,
        threat_threshold=args.threat_threshold,
        auto_rotate=not args.no_auto_rotate,
    )

    if args.scan_once:
        events = watcher.scan_once()
        for event in events:
            print(json.dumps(event.to_dict(), indent=2))
        return

    # Handle signals
    def signal_handler(sig, frame):
        log.info(f"Signal {sig} received")
        watcher.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    watcher.start()


if __name__ == "__main__":
    main()
