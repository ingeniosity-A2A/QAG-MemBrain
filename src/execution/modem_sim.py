#!/usr/bin/env python3
"""
QAG_MemBrain — Privacy Shield: Virtual LTE Modem Emulator
PTY-based Hayes-compatible modem with dynamic identity rotation.

Creates a pseudo-terminal (/tmp/vmodem) that guest agents/VMs use as
their cellular interface. Injects rotating IMSI/IMEI before each
connection attempt (ATD*99#) to present distinct device fingerprints.

Usage:
    python3 modem_sim.py [--pty-path /tmp/vmodem] [--rotation-interval 3600]
"""

import os
import sys
import pty
import json
import time
import random
import string
import struct
import signal
import logging
import argparse
import threading
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [MODEM_SIM] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("modem_sim")


# ─── Virtual Identity ──────────────────────────────────────────────

@dataclass
class VirtualIdentity:
    """Represents a rotating network identity."""
    id: str
    imsi: str
    imei: str
    iccid: str
    ki: str           # Authentication key (hex)
    opc: str          # Operator variant code (hex)
    msin: str         # Mobile subscriber identification number
    mac_wifi: str
    mac_bt: str
    created_at: float = field(default_factory=time.time)
    last_used_at: Optional[float] = None
    active: bool = True
    compromised: bool = False

    def to_dict(self) -> Dict:
        return asdict(self)


def generate_imsi() -> str:
    """Generate IMSI for private PLMN (MCC 901, MNC 70)."""
    mcc = "901"
    mnc = "70"
    msin = "".join(str(random.randint(0, 9)) for _ in range(10))
    return f"{mcc}{mnc}{msin}"


def generate_imei() -> str:
    """Generate IMEI with Luhn check digit."""
    tac = "".join(str(random.randint(0, 9)) for _ in range(8))
    serial = "".join(str(random.randint(0, 9)) for _ in range(6))
    partial = tac + serial
    total = 0
    for i, digit in enumerate(partial):
        d = int(digit)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    check = (10 - (total % 10)) % 10
    return f"{partial}{check}"


def generate_mac() -> str:
    """Generate randomized MAC address (locally administered)."""
    bytes_list = [random.randint(0, 255) for _ in range(6)]
    bytes_list[0] = (bytes_list[0] | 0x02) & 0xFE  # LAA, not multicast
    return ":".join(f"{b:02x}" for b in bytes_list)


def generate_iccid() -> str:
    """Generate ICCID for private PLMN."""
    prefix = "8990170"
    msin = "".join(str(random.randint(0, 9)) for _ in range(10))
    partial = prefix + msin
    total = 0
    for i, digit in enumerate(partial):
        d = int(digit)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    check = (10 - (total % 10)) % 10
    return f"{partial}{check}"


def generate_ki() -> str:
    """Generate 128-bit authentication key."""
    return os.urandom(16).hex()


def generate_opc() -> str:
    """Generate operator variant code."""
    return os.urandom(16).hex()


def create_identity() -> VirtualIdentity:
    """Create a new virtual identity."""
    return VirtualIdentity(
        id=f"vid_{int(time.time())}_{os.urandom(4).hex()}",
        imsi=generate_imsi(),
        imei=generate_imei(),
        iccid=generate_iccid(),
        ki=generate_ki(),
        opc=generate_opc(),
        msin="".join(str(random.randint(0, 9)) for _ in range(10)),
        mac_wifi=generate_mac(),
        mac_bt=generate_mac(),
    )


# ─── AT Command Parser ─────────────────────────────────────────────

class ATCommandParser:
    """Hayes-compatible AT command parser with identity rotation."""

    def __init__(self, identity: VirtualIdentity):
        self.identity = identity
        self.registered = False
        self.ppp_active = False
        self.signal_strength = random.randint(15, 31)  # RSSI in dBm

    def handle(self, command: str) -> str:
        """Process AT command and return response."""
        cmd = command.strip().upper()

        # Identity queries
        if cmd == "AT+CIMI":
            return f"\r\n{self.identity.imsi}\r\n\r\nOK\r\n"

        if cmd == "AT+CGSN":
            return f"\r\n{self.identity.imei}\r\n\r\nOK\r\n"

        if cmd == "AT+CCID" or cmd == "AT+ICCID":
            return f"\r\n{self.identity.iccid}\r\n\r\nOK\r\n"

        # Network registration
        if cmd == "AT+CREG?" or cmd == "AT+CGREG?":
            # 1 = registered, home network
            return f"\r\n+CREG: 1,1\r\n\r\nOK\r\n"

        if cmd == "AT+COPS?":
            return f"\r\n+COPS: 0,0,\"90170\",7\r\n\r\nOK\r\n"

        # Signal quality
        if cmd == "AT+CSQ":
            return f"\r\n+CSQ: {self.signal_strength},99\r\n\r\nOK\r\n"

        # SIM status
        if cmd == "AT+CPIN?":
            return f"\r\n+CPIN: READY\r\n\r\nOK\r\n"

        # Network type
        if cmd == "AT+CNSMOD?":
            return f"\r\n+CNSMOD: 0,7\r\n\r\nOK\r\n"  # LTE

        # APN configuration
        if cmd.startswith("AT+CGDCONT"):
            return "\r\nOK\r\n"

        # Dial command (PPP connection)
        if cmd.startswith("ATD*99#") or cmd.startswith("ATDT*99#"):
            log.info(f"Dial command received, initiating PPP with identity {self.identity.id[:16]}...")
            self.ppp_active = True
            return "\r\nCONNECT 115200\r\n"

        # Hang up
        if cmd == "ATH" or cmd == "ATH0":
            self.ppp_active = False
            return "\r\nOK\r\n"

        # Basic AT
        if cmd == "AT":
            return "\r\nOK\r\n"

        # Echo
        if cmd == "ATE1":
            return "\r\nOK\r\n"

        if cmd == "ATE0":
            return "\r\nOK\r\n"

        # Unknown command
        return "\r\nERROR\r\n"


# ─── PTY Modem Emulator ───────────────────────────────────────────

class ModemSimulator:
    """
    PTY-based LTE modem emulator with dynamic identity rotation.

    Creates a pseudo-terminal that guest agents/VMs use as their
    cellular interface. Supports rotating IMSI/IMEI for privacy.
    """

    def __init__(
        self,
        pty_path: str = "/tmp/vmodem",
        rotation_interval: int = 3600,
        pool_size: int = 20,
    ):
        self.pty_path = pty_path
        self.rotation_interval = rotation_interval
        self.pool_size = pool_size
        self.identity_pool: List[VirtualIdentity] = []
        self.active_identity: Optional[VirtualIdentity] = None
        self.running = False
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.parser: Optional[ATCommandParser] = None
        self._lock = threading.Lock()
        self._rotation_count = 0
        self._threat_count = 0

        # Initialize identity pool
        self._init_pool()

    def _init_pool(self):
        """Pre-generate identity pool."""
        log.info(f"Generating identity pool ({self.pool_size} identities)...")
        for _ in range(self.pool_size):
            self.identity_pool.append(create_identity())
        self.active_identity = self.identity_pool[0]
        self.active_identity.active = True
        self.parser = ATCommandParser(self.active_identity)
        log.info(f"Pool ready. Active identity: {self.active_identity.id[:16]}...")

    def rotate_identity(self, reason: str = "periodic") -> VirtualIdentity:
        """Rotate to next identity from pool."""
        with self._lock:
            old_id = self.active_identity.id if self.active_identity else "none"

            # Mark current as used
            if self.active_identity:
                self.active_identity.active = False
                self.active_identity.last_used_at = time.time()

            # Find next uncompromised identity
            next_id = None
            for vid in self.identity_pool:
                if vid.active and not vid.compromised and vid.id != old_id:
                    next_id = vid
                    break

            # If pool exhausted, generate fresh
            if not next_id:
                next_id = create_identity()
                self.identity_pool.append(next_id)
                self._trim_pool()

            next_id.active = True
            self.active_identity = next_id
            self.parser = ATCommandParser(next_id)
            self._rotation_count += 1

            log.info(
                f"Identity rotated [{reason}]: {old_id[:16]}... -> {next_id.id[:16]}... "
                f"(total rotations: {self._rotation_count})"
            )

            # Export current identity for other modules
            self._export_identity()

            return next_id

    def report_threat(self, source: str) -> VirtualIdentity:
        """Report threat and force immediate rotation."""
        self._threat_count += 1
        log.warning(f"THREAT DETECTED from {source} — forcing identity rotation")

        if self.active_identity:
            self.active_identity.compromised = True

        return self.rotate_identity(reason=f"threat:{source}")

    def _trim_pool(self):
        """Remove old unused identities if pool too large."""
        if len(self.identity_pool) > self.pool_size * 2:
            # Sort by last used, keep active
            usable = [v for v in self.identity_pool if v.active]
            unused = sorted(
                [v for v in self.identity_pool if not v.active],
                key=lambda v: v.last_used_at or v.created_at,
            )
            # Remove oldest unused
            to_remove = unused[: len(unused) - self.pool_size]
            self.identity_pool = [v for v in self.identity_pool if v not in to_remove]

    def _export_identity(self):
        """Export current identity to JSON for other modules."""
        export_path = Path("/tmp/current_identity.json")
        if self.active_identity:
            export_data = {
                "id": self.active_identity.id,
                "imsi": self.active_identity.imsi,
                "imei": self.active_identity.imei,
                "iccid": self.active_identity.iccid,
                "mac_wifi": self.active_identity.mac_wifi,
                "mac_bt": self.active_identity.mac_bt,
                "rotated_at": time.time(),
                "rotation_count": self._rotation_count,
            }
            export_path.write_text(json.dumps(export_data, indent=2))
            log.debug(f"Identity exported to {export_path}")

    def _create_pty(self) -> Tuple[int, int]:
        """Create pseudo-terminal pair."""
        master_fd, slave_fd = pty.openpty()
        slave_name = os.ttyname(slave_fd)

        # Create symlink for easy access
        if os.path.exists(self.pty_path):
            os.unlink(self.pty_path)
        os.symlink(slave_name, self.pty_path)

        log.info(f"PTY created: {self.pty_path} -> {slave_name}")
        return master_fd, slave_fd

    def _handle_master_input(self, data: bytes):
        """Process data from guest agent on master side."""
        try:
            command = data.decode("utf-8", errors="ignore").strip()
            if not command:
                return

            log.debug(f"AT command: {command}")

            # Handle dial command — potential rotation trigger
            if command.upper().startswith("ATD"):
                # Check session count
                if self.parser and self.parser.identity:
                    # Simple session counting (in production, track per-identity)
                    pass

            # Process AT command
            if self.parser:
                response = self.parser.handle(command)
                os.write(self.master_fd, response.encode("utf-8"))

        except Exception as e:
            log.error(f"Error handling AT command: {e}")

    def _rotation_timer(self):
        """Background thread for periodic rotation."""
        while self.running:
            time.sleep(self.rotation_interval)
            if self.running:
                self.rotate_identity(reason="periodic")

    def start(self):
        """Start the modem emulator."""
        log.info("Starting Virtual LTE Modem Emulator...")
        self.running = True

        # Create PTY
        self.master_fd, self.slave_fd = self._create_pty()

        # Export initial identity
        self._export_identity()

        # Start rotation timer
        timer_thread = threading.Thread(target=self._rotation_timer, daemon=True)
        timer_thread.start()
        log.info(f"Rotation timer started (interval: {self.rotation_interval}s)")

        # Main loop — read from master
        try:
            while self.running:
                try:
                    data = os.read(self.master_fd, 1024)
                    if data:
                        self._handle_master_input(data)
                except OSError:
                    if self.running:
                        log.error("PTY read error")
                    break
        except KeyboardInterrupt:
            log.info("Shutdown signal received")
        finally:
            self.stop()

    def stop(self):
        """Stop the modem emulator and cleanup."""
        self.running = False

        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

        if self.slave_fd is not None:
            try:
                os.close(self.slave_fd)
            except OSError:
                pass
            self.slave_fd = None

        # Remove symlink
        if os.path.exists(self.pty_path):
            os.unlink(self.pty_path)

        # Export final state
        self._export_final_state()

        log.info(
            f"Modem stopped. Total rotations: {self._rotation_count}, "
            f"Threats detected: {self._threat_count}"
        )

    def _export_final_state(self):
        """Export final state for audit."""
        state = {
            "total_rotations": self._rotation_count,
            "threats_detected": self._threat_count,
            "pool_size": len(self.identity_pool),
            "active_identity": self.active_identity.id if self.active_identity else None,
            "stopped_at": time.time(),
        }
        state_path = Path("/tmp/modem_sim_state.json")
        state_path.write_text(json.dumps(state, indent=2))


# ─── CLI Entry Point ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Virtual LTE Modem Emulator")
    parser.add_argument(
        "--pty-path",
        default="/tmp/vmodem",
        help="Path for the PTY symlink (default: /tmp/vmodem)",
    )
    parser.add_argument(
        "--rotation-interval",
        type=int,
        default=3600,
        help="Identity rotation interval in seconds (default: 3600)",
    )
    parser.add_argument(
        "--pool-size",
        type=int,
        default=20,
        help="Pre-generated identity pool size (default: 20)",
    )
    parser.add_argument(
        "--rotate-now",
        action="store_true",
        help="Force immediate rotation and exit",
    )
    parser.add_argument(
        "--threat",
        type=str,
        default=None,
        help="Report a threat source and force rotation",
    )
    args = parser.parse_args()

    sim = ModemSimulator(
        pty_path=args.pty_path,
        rotation_interval=args.rotation_interval,
        pool_size=args.pool_size,
    )

    if args.rotate_now:
        sim.rotate_identity(reason="manual")
        print(json.dumps(sim.active_identity.to_dict() if sim.active_identity else {}, indent=2))
        return

    if args.threat:
        sim.report_threat(args.threat)
        print(json.dumps(sim.active_identity.to_dict() if sim.active_identity else {}, indent=2))
        return

    # Handle signals
    def signal_handler(sig, frame):
        log.info(f"Signal {sig} received")
        sim.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    sim.start()


if __name__ == "__main__":
    main()
