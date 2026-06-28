#!/usr/bin/env python3
"""
Enhanced Virtual LTE/NR Modem — SIF Termux Edition
====================================================
Knox-safe pseudo-terminal modem with full 6G readiness.
Termux-compatible: No PPP, no root, no kernel modules.

Supports: VoNR, WiFi 7 MLO, eSIM, beamforming, network extender,
          SOCAT tunnels, SOCKS5 proxy, TCP relay.

License: MIT
Target: Samsung S25/S26 Ultra (Termux, ARM64)
"""

import os
import pty
import threading
import time
import json
import subprocess
import signal
import sys
import hashlib
import socket
import select
import struct
import asyncio
import numpy as np
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Callable
from http.server import HTTPServer, BaseHTTPRequestHandler
import socketserver

# ═══════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════

@dataclass
class VirtualIdentity:
    """Represents a single virtual subscriber identity."""
    imsi: str = "310260000000001"
    imei: str = "490154203237518"
    msisdn: str = "15551234567"
    ki: str = ""
    opc: str = ""
    iccid: str = "8914800000000000001"
    operator: str = "SIF-Sovereign"

@dataclass
class AntennaElement:
    """Single antenna element for beamforming simulation."""
    x: float
    y: float
    z: float
    gain_dbi: float = 3.0
    polarization: str = "vertical"
    phase_offset: float = 0.0

@dataclass
class CallSession:
    """VoNR call session."""
    call_id: str
    caller: str
    callee: str
    state: str = "active"
    codec: str = "EVS"
    rtp_port: int = 16384

@dataclass
class ESimProfile:
    """GSMA SGP.22 eSIM profile."""
    iccid: str
    name: str
    mcc_mnc: str = "310260"
    state: str = "disabled"

@dataclass
class TunnelSession:
    """Active data tunnel session."""
    port: int
    tunnel_type: str  # "socat", "socks5", "tcp_relay"
    process: Optional[subprocess.Popen] = None
    data_pty: Optional[str] = None

# ═══════════════════════════════════════════════════════════════
# SUBSYSTEMS
# ═══════════════════════════════════════════════════════════════

class VirtualAntennaArray:
    """
    8-element phased array simulation for beamforming.
    Models realistic RF propagation without hardware.
    """
    
    def __init__(self, freq_hz: float = 3.5e9):
        self.freq = freq_hz
        self.wavelength = 3e8 / freq_hz
        self.elements = [
            AntennaElement(x=0.00, y=0.00, z=0),
            AntennaElement(x=0.04, y=0.00, z=0),
            AntennaElement(x=0.08, y=0.00, z=0),
            AntennaElement(x=0.12, y=0.00, z=0),
            AntennaElement(x=0.00, y=0.04, z=0),
            AntennaElement(x=0.04, y=0.04, z=0),
            AntennaElement(x=0.08, y=0.04, z=0),
            AntennaElement(x=0.12, y=0.04, z=0),
        ]
        self.current_beam = (0.0, 0.0)  # azimuth, elevation
    
    def beamform(self, az_deg: float, el_deg: float) -> np.ndarray:
        """Calculate complex beamforming weights for target angle."""
        az = np.radians(az_deg)
        el = np.radians(el_deg)
        weights = np.zeros(len(self.elements), dtype=complex)
        
        for i, elem in enumerate(self.elements):
            phase = -2 * np.pi / self.wavelength * (
                elem.x * np.sin(el) * np.cos(az) +
                elem.y * np.sin(el) * np.sin(az)
            )
            weights[i] = np.exp(1j * phase)
        
        self.current_beam = (az_deg, el_deg)
        return weights
    
    def rssi(self, distance_m: float, tx_power_dbm: float = 23.0) -> int:
        """Calculate RSSI using Friis transmission equation with shadowing."""
        fspl = 20 * np.log10(distance_m) + 20 * np.log10(self.freq) - 147.55
        shadowing = np.random.normal(0, 4.0)
        array_gain = 10 * np.log10(len(self.elements))
        rx_power = tx_power_dbm - fspl - shadowing + array_gain
        
        if rx_power >= -51:
            return 31
        elif rx_power <= -113:
            return 0
        return int((rx_power + 113) * 31 / 62)
    
    def get_status(self) -> dict:
        """Return current antenna array status."""
        return {
            "elements": len(self.elements),
            "frequency_ghz": self.freq / 1e9,
            "wavelength_mm": self.wavelength * 1000,
            "beam_azimuth": self.current_beam[0],
            "beam_elevation": self.current_beam[1],
        }


class VonrStack:
    """5G Voice over New Radio with IMS/SIP signaling."""
    
    def __init__(self):
        self.calls: Dict[str, CallSession] = {}
        self.registered = False
        self.sip_proxy = "sip.sif-sovereign.local"
    
    async def register(self, msisdn: str) -> bool:
        """Register with IMS core."""
        print(f"[VoNR] IMS Registration for {msisdn} via {self.sip_proxy}")
        self.registered = True
        return True
    
    async def dial(self, caller: str, callee: str, codec: str = "EVS") -> CallSession:
        """Initiate VoNR call with codec negotiation."""
        cid = f"call-{len(self.calls):04d}"
        session = CallSession(
            call_id=cid,
            caller=caller,
            callee=callee,
            codec=codec,
            rtp_port=16384 + len(self.calls) * 2
        )
        self.calls[cid] = session
        print(f"[VoNR] Call established: {cid}")
        print(f"[VoNR]   {caller} → {callee}")
        print(f"[VoNR]   Codec: {codec}, RTP: {session.rtp_port}")
        return session
    
    def hangup(self, cid: str) -> bool:
        """Terminate VoNR call."""
        if cid in self.calls:
            del self.calls[cid]
            print(f"[VoNR] Call terminated: {cid}")
            return True
        return False
    
    def get_status(self) -> dict:
        """Return VoNR stack status."""
        return {
            "registered": self.registered,
            "active_calls": len(self.calls),
            "calls": [
                {"id": c.call_id, "caller": c.caller, "callee": c.callee,
                 "codec": c.codec, "state": c.state}
                for c in self.calls.values()
            ]
        }


class VirtualEuicc:
    """Virtual embedded UICC implementing GSMA SGP.22 RSP."""
    
    def __init__(self):
        self.eid = hashlib.sha256(b"SIF-Sovereign-eUICC-v2").hexdigest()[:32].upper()
        self.profiles: Dict[str, ESimProfile] = {}
        self.active_iccid: Optional[str] = None
        print(f"[eUICC] Initialized with EID: {self.eid}")
    
    def download(self, activation_code: str) -> Optional[ESimProfile]:
        """Download eSIM profile from SM-DP+ (simulated)."""
        parts = activation_code.split('$')
        matching_id = parts[-1] if len(parts) >= 3 else activation_code
        
        iccid = "89" + hashlib.sha256(matching_id.encode()).hexdigest()[:18]
        
        # Check for duplicate
        if iccid in self.profiles:
            print(f"[eUICC] Profile {iccid} already exists")
            return self.profiles[iccid]
        
        profile = ESimProfile(
            iccid=iccid,
            name=f"SIF-Profile-{matching_id[:8]}",
            mcc_mnc="310260"
        )
        self.profiles[iccid] = profile
        print(f"[eUICC] Profile downloaded: {profile.name}")
        print(f"[eUICC]   ICCID: {iccid}")
        return profile
    
    def enable(self, iccid: str) -> bool:
        """Enable an eSIM profile (disables current active)."""
        if iccid not in self.profiles:
            print(f"[eUICC] Profile {iccid} not found")
            return False
        
        # Disable current active
        if self.active_iccid and self.active_iccid in self.profiles:
            self.profiles[self.active_iccid].state = "disabled"
        
        # Enable requested
        self.profiles[iccid].state = "enabled"
        self.active_iccid = iccid
        print(f"[eUICC] Profile enabled: {iccid}")
        return True
    
    def disable(self, iccid: str) -> bool:
        """Disable an eSIM profile."""
        if iccid not in self.profiles:
            return False
        self.profiles[iccid].state = "disabled"
        if self.active_iccid == iccid:
            self.active_iccid = None
        return True
    
    def delete(self, iccid: str) -> bool:
        """Delete an eSIM profile."""
        if iccid not in self.profiles:
            return False
        if self.active_iccid == iccid:
            self.disable(iccid)
        del self.profiles[iccid]
        print(f"[eUICC] Profile deleted: {iccid}")
        return True
    
    def list_all(self) -> list:
        """List all installed profiles."""
        return [
            {
                "iccid": p.iccid,
                "name": p.name,
                "mcc_mnc": p.mcc_mnc,
                "state": p.state,
                "active": p.iccid == self.active_iccid
            }
            for p in self.profiles.values()
        ]
    
    def get_active(self) -> Optional[dict]:
        """Get currently active profile."""
        if self.active_iccid and self.active_iccid in self.profiles:
            p = self.profiles[self.active_iccid]
            return {"iccid": p.iccid, "name": p.name, "mcc_mnc": p.mcc_mnc}
        return None


class VirtualWifiMLO:
    """WiFi 7 Multi-Link Operation controller (2.4 + 5 + 6 GHz)."""
    
    def __init__(self):
        self.links: Dict[int, dict] = {}
        self.mode = "MLO"  # MLO, EMLSR, MLMR
        self.configured = False
    
    def configure(self, bands: List[str] = None) -> dict:
        """Configure MLO across specified bands."""
        if bands is None:
            bands = ["2.4GHz", "5GHz", "6GHz"]
        
        configs = {
            "2.4GHz": {"ch": 6,  "bw": 40,  "mcs": 11, "ss": 2},
            "5GHz":   {"ch": 36, "bw": 160, "mcs": 13, "ss": 4},
            "6GHz":   {"ch": 69, "bw": 320, "mcs": 15, "ss": 4},
        }
        
        self.links.clear()
        for i, band in enumerate(bands[:3]):
            cfg = configs.get(band, configs["5GHz"])
            self.links[i + 1] = {
                "link_id": i + 1,
                "band": band,
                "channel": cfg["ch"],
                "bandwidth_mhz": cfg["bw"],
                "mcs_index": cfg["mcs"],
                "spatial_streams": cfg["ss"],
                "bssid": f"02:00:00:00:00:{i+1:02x}",
                "state": "active"
            }
        
        self.configured = True
        total_bw = sum(l["bandwidth_mhz"] for l in self.links.values())
        
        print(f"[WiFi7] MLO configured: {len(self.links)} links")
        for link in self.links.values():
            print(f"[WiFi7]   Link {link['link_id']}: {link['band']} @ {link['bandwidth_mhz']}MHz")
        print(f"[WiFi7]   Total bandwidth: {total_bw}MHz")
        
        return {
            "links": len(self.links),
            "mode": self.mode,
            "total_bandwidth_mhz": total_bw,
            "links_detail": list(self.links.values())
        }
    
    def set_mode(self, mode: str) -> bool:
        """Switch between MLO, EMLSR, and MLMR modes."""
        valid_modes = ["MLO", "EMLSR", "MLMR"]
        if mode not in valid_modes:
            return False
        self.mode = mode
        print(f"[WiFi7] Mode switched to {mode}")
        return True
    
    def get_status(self) -> dict:
        """Return WiFi MLO status."""
        return {
            "configured": self.configured,
            "mode": self.mode,
            "links": len(self.links),
            "links_detail": list(self.links.values())
        }


class VirtualHeNB:
    """Virtual Home eNodeB / Network Extender with IPSec tunneling."""
    
    def __init__(self, henb_id: str = "SIF-HENB-001", csg_id: str = "SIF-CSG-01"):
        self.henb_id = henb_id
        self.csg_id = csg_id
        self.plmn = "00101"
        self.ues: Dict[str, dict] = {}
        self.tunnel_active = False
        self.ike_spi: Optional[str] = None
    
    def establish_tunnel(self, se_gw: str = "192.168.42.1") -> bool:
        """Establish IKEv2/IPsec tunnel to Security Gateway."""
        self.ike_spi = hashlib.sha256(
            f"{self.henb_id}-{time.time()}".encode()
        ).hexdigest()[:16]
        self.tunnel_active = True
        print(f"[HeNB] IPSec tunnel established")
        print(f"[HeNB]   HeNB: {self.henb_id}")
        print(f"[HeNB]   SeGW: {se_gw}")
        print(f"[HeNB]   SPI:  {self.ike_spi}")
        return True
    
    def attach_ue(self, imsi: str) -> dict:
        """Attach UE to virtual femtocell."""
        if imsi in self.ues:
            return self.ues[imsi]
        
        import ipaddress
        ip = str(ipaddress.IPv4Address(f"192.168.43.{len(self.ues) + 10}"))
        guti = f"guti-{hashlib.md5(imsi.encode()).hexdigest()[:8]}"
        
        ctx = {
            "imsi": imsi,
            "ip_address": ip,
            "guti": guti,
            "csg_id": self.csg_id,
            "tac": 7,
            "bearer_id": len(self.ues) + 5,
            "state": "attached",
            "attached_at": time.time()
        }
        self.ues[imsi] = ctx
        print(f"[HeNB] UE attached: IMSI {imsi[:6]}*** → {ip}")
        return ctx
    
    def detach_ue(self, imsi: str) -> bool:
        """Detach UE from femtocell."""
        if imsi in self.ues:
            del self.ues[imsi]
            print(f"[HeNB] UE detached: IMSI {imsi[:6]}***")
            return True
        return False
    
    def get_status(self) -> dict:
        """Return HeNB status."""
        return {
            "henb_id": self.henb_id,
            "csg_id": self.csg_id,
            "plmn": self.plmn,
            "tunnel_active": self.tunnel_active,
            "attached_ues": len(self.ues),
            "ues": [
                {"imsi": u["imsi"][:6] + "***", "ip": u["ip_address"],
                 "guti": u["guti"], "state": u["state"]}
                for u in self.ues.values()
            ]
        }

# ═══════════════════════════════════════════════════════════════
# ENHANCED VIRTUAL MODEM — TERMUX COMPATIBLE
# ═══════════════════════════════════════════════════════════════

class EnhancedVirtualModem:
    """
    Complete 6G-ready virtual modem.
    No PPP required — uses SOCAT tunnels, SOCKS5 proxy, and TCP relay.
    Fully Termux-compatible.
    """
    
    def __init__(self, pty_path: str = "/tmp/vmodem", identity_file: str = None):
        # PTY paths
        self.pty_path = pty_path
        self.master_fd = None
        self.slave_fd = None
        self.running = False
        
        # Identity management
        self.id = VirtualIdentity()
        self.pool: List[VirtualIdentity] = [self.id]
        if identity_file and os.path.exists(identity_file):
            try:
                with open(identity_file) as f:
                    data = json.load(f)
                    self.pool = [VirtualIdentity(**d) for d in data]
                    if self.pool:
                        self.id = self.pool[0]
                print(f"[Modem] Loaded {len(self.pool)} identities from {identity_file}")
            except Exception as e:
                print(f"[Modem] Failed to load identities: {e}")
        
        # Network state
        self.registered = True
        self.signal = 31
        self.data_active = False
        
        # Termux-compatible tunnels (NO PPP)
        self.active_tunnels: List[TunnelSession] = []
        self.socks_server: Optional[socketserver.TCPServer] = None
        
        # Subsystems
        self.vonr = VonrStack()
        self.wifi = VirtualWifiMLO()
        self.esim = VirtualEuicc()
        self.antenna = VirtualAntennaArray()
        self.henb = VirtualHeNB()
        
        # AT command dispatch table
        self.commands: Dict[str, Callable] = {
            # Basic AT
            "AT": lambda c: "OK",
            "ATE0": lambda c: "OK",
            "ATE1": lambda c: "OK",
            "ATZ": lambda c: "OK",
            "AT&F": lambda c: "OK",
            
            # Manufacturer info
            "AT+CGMI": lambda c: "Sovereign Intelligence Fabric",
            "AT+CGMM": lambda c: "SIF-LTE-NR-VMODEM-v4",
            "AT+CGMR": lambda c: "AVA007_RUNTIME_TERMUX_R1",
            "AT+CGSN": lambda c: self.id.imei,
            "AT+CIMI": lambda c: self.id.imsi,
            "AT+CCID": lambda c: self.id.iccid,
            
            # Network
            "AT+CREG": self._cmd_creg,
            "AT+COPS": self._cmd_cops,
            "AT+CSQ": self._cmd_csq,
            "AT+CGDCONT": lambda c: "OK",
            "AT+CMEE": lambda c: "OK",
# Data connection (Termux-compatible)
            "ATD*99#": self._cmd_dial_socat,
            "ATD*99***1#": self._cmd_dial_socks,
            "ATD*99***2#": self._cmd_dial_relay,
            "ATH": self._cmd_hangup,
            
            # eSIM management
            "AT+ESIM": self._cmd_esim,
            
            # WiFi 7 MLO
            "AT+WIFI": self._cmd_wifi,
            
            # Beamforming
            "AT+BEAM": self._cmd_beam,
            
            # Network Extender
            "AT+HENB": self._cmd_henb,
            
            # Antenna status
            "AT+ANTENNA": self._cmd_antenna,
            
            # VoNR voice
            "AT+VONR": self._cmd_vonr,
            
            # System
            "AT+STATUS": self._cmd_status,
            "AT+HELP": self._cmd_help,
        }
        
        # Stats
        self.rotation_count = 0
        self.start_time = time.time()
    
    # ── AT Command Handlers ──────────────────────────────────
    
    def _cmd_creg(self, cmd: str) -> str:
        if "=2" in cmd:
            self.registered = True
        stat = 1 if self.registered else 0
        return f"+CREG: {stat},1"
    
    def _cmd_cops(self, cmd: str) -> str:
        if "=?" in cmd:
            return f'+COPS: (2,"{self.id.operator}","{self.id.operator}","00101",7)'
        return f'+COPS: 0,0,"{self.id.operator}",7'
    
    def _cmd_csq(self, cmd: str) -> str:
        return f"+CSQ: {self.signal},99"
    
    # ── Termux-Compatible Data Connections ──────────────────
    
    def _cmd_dial_socat(self, cmd: str) -> str:
        """
        ATD*99# — Dial using SOCAT PTY-to-TCP tunnel.
        Termux-compatible: No PPP, no kernel modules.
        """
        if self.data_active:
            return "BUSY"
        
        print("[Modem] ═══ Dial Request (SOCAT Tunnel) ═══")
        
        port = 1080 + len(self.active_tunnels)
        data_pty = f"/tmp/vmodem_data_{len(self.active_tunnels)}"
        
        try:
            tunnel_proc = subprocess.Popen([
                "socat",
                f"PTY,raw,echo=0,link={data_pty}",
                f"TCP4:localhost:{port}"
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            tunnel = TunnelSession(
                port=port,
                tunnel_type="socat",
                process=tunnel_proc,
                data_pty=data_pty
            )
            self.active_tunnels.append(tunnel)
            self.data_active = True
            
            time.sleep(1)
            
            print(f"[Modem] Tunnel established: localhost:{port}")
            print(f"[Modem] Data PTY: {data_pty}")
            
            return f"CONNECT 150000000\r\n+TUNNEL: localhost:{port}\r\n+PTY: {data_pty}"
            
        except FileNotFoundError:
            # SOCAT not installed — fallback to Python relay
            return self._cmd_dial_relay(cmd)
        except Exception as e:
            print(f"[Modem] Tunnel error: {e}")
            return "NO CARRIER"
    
    def _cmd_dial_socks(self, cmd: str) -> str:
        """
        ATD*99***1# — Dial using built-in SOCKS5 proxy.
        Fully self-contained, no external dependencies.
        """
        if self.data_active:
            return "BUSY"
        
        print("[Modem] ═══ Dial Request (SOCKS5 Proxy) ═══")
        
        port = 9050 + len(self.active_tunnels)
        
        try:
            self._start_socks5_proxy(port)
            
            tunnel = TunnelSession(
                port=port,
                tunnel_type="socks5"
            )
            self.active_tunnels.append(tunnel)
            self.data_active = True
            
            time.sleep(0.5)
            
            print(f"[Modem] SOCKS5 proxy: localhost:{port}")
            
            return f"CONNECT 150000000\r\n+SOCKS5: localhost:{port}"
            
        except Exception as e:
            print(f"[Modem] SOCKS5 error: {e}")
            return "NO CARRIER"
    
    def _cmd_dial_relay(self, cmd: str) -> str:
        """
        ATD*99***2# — Dial using Python TCP relay.
        Zero external dependencies, pure Python.
        """
        if self.data_active:
            return "BUSY"
        
        print("[Modem] ═══ Dial Request (TCP Relay) ═══")
        
        port = 8080 + len(self.active_tunnels)
        
        try:
            self._start_tcp_relay(port)
            
            tunnel = TunnelSession(
                port=port,
                tunnel_type="tcp_relay"
            )
            self.active_tunnels.append(tunnel)
            self.data_active = True
            
            time.sleep(0.5)
            
            print(f"[Modem] TCP relay: localhost:{port}")
            
            return f"CONNECT 150000000\r\n+RELAY: localhost:{port}"
            
        except Exception as e:
            print(f"[Modem] Relay error: {e}")
            return "NO CARRIER"
    
    def _cmd_hangup(self, cmd: str) -> str:
        """ATH — Hang up data connection."""
        self._disconnect_all_tunnels()
        return "OK"
    
    # ── Subsystem Commands ──────────────────────────────────
    
    def _cmd_esim(self, cmd: str) -> str:
        if "=LIST" in cmd:
            profiles = self.esim.list_all()
            if not profiles:
                return "+ESIM: No profiles installed"
            lines = []
            for p in profiles:
                active = "*" if p["active"] else " "
                lines.append(f'+ESIM: [{active}] {p["iccid"]},{p["name"]},{p["state"]}')
            return "\r\n".join(lines)
        
        if "=DOWNLOAD=" in cmd:
            code = cmd.split("=", 2)[2].strip('"')
            profile = self.esim.download(code)
            if profile:
                return f'+ESIM: Downloaded {profile.iccid}'
            return "+ESIM: Download failed"
        
        if "=ENABLE=" in cmd:
            iccid = cmd.split("=", 2)[2]
            ok = self.esim.enable(iccid)
            return f'+ESIM: {"Enabled" if ok else "Failed"} {iccid}'
        
        if "=DISABLE=" in cmd:
            iccid = cmd.split("=", 2)[2]
            ok = self.esim.disable(iccid)
            return f'+ESIM: {"Disabled" if ok else "Failed"} {iccid}'
        
        if "=DELETE=" in cmd:
            iccid = cmd.split("=", 2)[2]
            ok = self.esim.delete(iccid)
            return f'+ESIM: {"Deleted" if ok else "Failed"} {iccid}'
        
        if "=ACTIVE?" in cmd:
            active = self.esim.get_active()
            if active:
                return f'+ESIM: Active={active["iccid"]},{active["name"]}'
            return "+ESIM: No active profile"
        
        return "ERROR"
    
    def _cmd_wifi(self, cmd: str) -> str:
        if "=CONFIG" in cmd:
            result = self.wifi.configure()
            return f'+WIFI: {result["links"]} links, {result["total_bandwidth_mhz"]}MHz total'
        
        if "=STATUS" in cmd:
            status = self.wifi.get_status()
            return f'+WIFI: Mode={status["mode"]}, Links={status["links"]}, Active={status["configured"]}'
        
        if "=MODE=" in cmd:
            mode = cmd.split("=", 2)[2]
            ok = self.wifi.set_mode(mode)
            return f'+WIFI: Mode {"set" if ok else "failed"} to {mode}'
        
        return "+WIFI: OK"
    
    def _cmd_beam(self, cmd: str) -> str:
        try:
            parts = cmd.replace("AT+BEAM=", "").split(",")
            if len(parts) >= 2:
                az, el = float(parts[0]), float(parts[1])
                self.antenna.beamform(az, el)
                return f"+BEAM: Steered to az={az:.1f}°, el={el:.1f}°"
        except (ValueError, IndexError):
            pass
        return "ERROR"
    
    def _cmd_henb(self, cmd: str) -> str:
        if "=ATTACH" in cmd:
            self.henb.establish_tunnel()
            ctx = self.henb.attach_ue(self.id.imsi)
            return f'+HENB: IP={ctx["ip_address"]}, GUTI={ctx["guti"]}'
        
        if "=DETACH" in cmd:
            self.henb.detach_ue(self.id.imsi)
            return "+HENB: Detached"
        
        if "=STATUS" in cmd:
            status = self.henb.get_status()
            return f'+HENB: UEs={status["attached_ues"]}, Tunnel={"UP" if status["tunnel_active"] else "DOWN"}'
        
        return "+HENB: OK"
    
    def _cmd_antenna(self, cmd: str) -> str:
        status = self.antenna.get_status()
        rssi = self.antenna.rssi(100)
        return f'+ANTENNA: {status["elements"]} elements, {status["frequency_ghz"]:.1f}GHz, RSSI {rssi}/31'
    
    def _cmd_vonr(self, cmd: str) -> str:
        if "=DIAL=" in cmd:
            number = cmd.split("=", 2)[2]
            loop = asyncio.new_event_loop()
            session = loop.run_until_complete(
                self.vonr.dial(f"tel:{self.id.msisdn}", f"tel:{number}")
            )
            loop.close()
            return f'+VONR: Call={session.call_id}, Codec={session.codec}'
        
        if "=HANGUP=" in cmd:
            cid = cmd.split("=", 2)[2]
            ok = self.vonr.hangup(cid)
            return f'+VONR: {"Terminated" if ok else "Not found"}'
        
        if "=STATUS" in cmd:
            status = self.vonr.get_status()
            return f'+VONR: Calls={status["active_calls"]}, Registered={status["registered"]}'
        
        return "+VONR: OK"
    
    def _cmd_status(self, cmd: str) -> str:
        """AT+STATUS — Full system status."""
        uptime = int(time.time() - self.start_time)
        lines = [
            f"+STATUS: SIF Virtual Modem v4.0",
            f"+STATUS: Uptime={uptime}s",
            f"+STATUS: IMSI={self.id.imsi[:6]}***",
            f"+STATUS: IMEI={self.id.imei[:8]}***",
            f"+STATUS: Registered={'Yes' if self.registered else 'No'}",
            f"+STATUS: Signal={self.signal}/31",
            f"+STATUS: Data={'Active' if self.data_active else 'Inactive'}",
            f"+STATUS: Tunnels={len(self.active_tunnels)}",
            f"+STATUS: eSIM Profiles={len(self.esim.profiles)}",
            f"+STATUS: VoNR Calls={len(self.vonr.calls)}",
            f"+STATUS: WiFi Links={len(self.wifi.links)}",
            f"+STATUS: Rotations={self.rotation_count}",
        ]
        return "\r\n".join(lines)
    
    def _cmd_help(self, cmd: str) -> str:
        """AT+HELP — List available commands."""
        commands = [
            "+HELP: === Basic ===",
            "+HELP: AT           - Basic attention",
            "+HELP: AT+CIMI      - Get IMSI",
            "+HELP: AT+CGSN      - Get IMEI",
            "+HELP: AT+CSQ       - Signal quality",
            "+HELP: AT+CREG?     - Registration status",
            "+HELP: AT+COPS?     - Operator selection",
            "+HELP: === Data ===",
            "+HELP: ATD*99#      - Dial (SOCAT tunnel)",
            "+HELP: ATD*99***1#  - Dial (SOCKS5 proxy)",
            "+HELP: ATD*99***2#  - Dial (TCP relay)",
            "+HELP: ATH          - Hang up",
            "+HELP: === eSIM ===",
            "+HELP: AT+ESIM=LIST - List profiles",
            "+HELP: AT+ESIM=DOWNLOAD=<code>",
            "+HELP: AT+ESIM=ENABLE=<iccid>",
            "+HELP: === Advanced ===",
            "+HELP: AT+WIFI=CONFIG",
            "+HELP: AT+BEAM=<az>,<el>",
            "+HELP: AT+HENB=ATTACH",
            "+HELP: AT+VONR=DIAL=<number>",
            "+HELP: AT+ANTENNA?",
            "+HELP: AT+STATUS",
        ]
        return "\r\n".join(commands)
    
    # ── Core Engine ──────────────────────────────────────────
    
    def _process_at(self, line: str) -> str:
        """Parse and dispatch AT commands with response formatting."""
        line = line.strip().upper()
        if not line:
            return ""
        
        # Try exact match first
        base_cmd = line.split("?")[0].split("=")[0]
        if base_cmd in self.commands:
            try:
                result = self.commands[base_cmd](line)
                if result:
                    return f"\r\n{result}\r\n\r\nOK\r\n"
                return "\r\nOK\r\n"
            except Exception as e:
                print(f"[Modem] Command error: {e}")
                return f"\r\nERROR\r\n"
        
        # Try prefix matching for sub-commands
        for cmd_key in sorted(self.commands.keys(), key=len, reverse=True):
            if line.startswith(cmd_key):
                try:
                    result = self.commands[cmd_key](line)
                    if result:
                        return f"\r\n{result}\r\n\r\nOK\r\n"
                    return "\r\nOK\r\n"
                except Exception as e:
                    print(f"[Modem] Command error ({cmd_key}): {e}")
        
        return "\r\nERROR\r\n"
    
    def _at_loop(self):
        """Main processing loop reading from pseudo-terminal."""
        buffer = ""
        while self.running:
            try:
                data = os.read(self.master_fd, 1024).decode('utf-8', errors='ignore')
                buffer += data
                
                while '\r' in buffer or '\n' in buffer:
                    end_r = buffer.find('\r')
                    end_n = buffer.find('\n')
                    
                    if end_r == -1:
                        end = end_n
                    elif end_n == -1:
                        end = end_r
                    else:
                        end = min(end_r, end_n)
                    
                    if end == -1:
                        break
                    
                    line = buffer[:end].strip()
                    buffer = buffer[end + 1:].lstrip('\n').lstrip('\r')
                    
                    if line:
                        response = self._process_at(line)
                        os.write(self.master_fd, response.encode('utf-8'))
                        
            except OSError:
                time.sleep(0.01)
    
    # ── Tunnel Management ────────────────────────────────────
    
    def _start_socks5_proxy(self, port: int):
        """Start built-in SOCKS5 proxy server."""
        
        class SOCKS5Handler(socketserver.StreamRequestHandler):
            def handle(this):
                try:
                    # Handshake
                    this.connection.recv(262)
                    this.connection.sendall(b'\x05\x00')
                    
                    # Request
                    data = this.connection.recv(4)
                    if len(data) < 4 or data[1] != 0x01:
                        return
                    
                    addr_type = data[3]
                    addr = None
                    port_num = None
                    
                    if addr_type == 0x01:  # IPv4
                        addr = socket.inet_ntoa(this.connection.recv(4))
                        port_num = struct.unpack('>H', this.connection.recv(2))[0]
                    elif addr_type == 0x03:  # Domain
                        domain_len = ord(this.connection.recv(1))
                        addr = this.connection.recv(domain_len).decode()
                        port_num = struct.unpack('>H', this.connection.recv(2))[0]
                    else:
                        return
                    
                    remote = socket.create_connection((addr, port_num), timeout=10)
                    this.connection.sendall(
                        b'\x05\x00\x00\x01' +
                        socket.inet_aton('0.0.0.0') +
                        struct.pack('>H', 0)
                    )
                    
                    # Bidirectional relay
                    sockets_list = [this.connection, remote]
                    while True:
                        r, _, _ = select.select(sockets_list, [], [], 30)
                        if not r:
                            break
                        for s in r:
                            data = s.recv(8192)
                            if not data:
                                sockets_list.remove(s)
                                continue
                            if s is this.connection:
                                remote.sendall(data)
                            else:
                                this.connection.sendall(data)
                        if len(sockets_list) < 2:
                            break
                            
                except Exception:
                    pass
                finally:
                    try:
                        remote.close()
                    except:
                        pass
        
        self.socks_server = socketserver.ThreadingTCPServer(
            ('127.0.0.1', port), SOCKS5Handler
        )
        threading.Thread(target=self.socks_server.serve_forever, daemon=True).start()
    
    def _start_tcp_relay(self, port: int, target_host: str = "192.168.42.1", target_port: int = 80):
        """Start Python-based TCP relay."""
        
        def handle_client(client_sock):
            remote_sock = None
            try:
                remote_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                remote_sock.settimeout(10)
                remote_sock.connect((target_host, target_port))
                
                sockets_list = [client_sock, remote_sock]
                while True:
                    r, _, _ = select.select(sockets_list, [], [], 30)
                    if not r:
                        break
                    for s in r:
                        data = s.recv(8192)
                        if not data:
                            sockets_list.remove(s)
                            continue
                        if s is client_sock:
                            remote_sock.sendall(data)
                        else:
                            client_sock.sendall(data)
                    if len(sockets_list) < 2:
                        break
            except Exception:
                pass
            finally:
                try:
                    client_sock.close()
                except:
                    pass
                if remote_sock:
                    try:
                        remote_sock.close()
                    except:
                        pass
        
        server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_sock.bind(('127.0.0.1', port))
        server_sock.listen(10)
        
        def accept_loop():
            while self.running:
                try:
                    server_sock.settimeout(1)
                    client, _ = server_sock.accept()
                    threading.Thread(target=handle_client, args=(client,), daemon=True).start()
                except socket.timeout:
                    continue
                except:
                    break
        
        threading.Thread(target=accept_loop, daemon=True).start()
    
    def _disconnect_all_tunnels(self):
        """Terminate all active data tunnels."""
        for tunnel in self.active_tunnels:
            if tunnel.process:
                try:
                    tunnel.process.terminate()
                    tunnel.process.wait(timeout=2)
                except:
                    try:
                        tunnel.process.kill()
                    except:
                        pass
            if tunnel.data_pty and os.path.exists(tunnel.data_pty):
                try:
                    os.unlink(tunnel.data_pty)
                except:
                    pass
        
        self.active_tunnels.clear()
        
        if self.socks_server:
            try:
                self.socks_server.shutdown()
            except:
                pass
            self.socks_server = None
        
        self.data_active = False
        print("[Modem] All tunnels disconnected")
    
  # ── REST API ─────────────────────────────────────────────
    
    def _rest_api(self):
        """HTTP REST API for identity rotation, status, and control."""
        modem = self
        
        class ModemAPI(BaseHTTPRequestHandler):
            def do_GET(this):
                if this.path == "/status":
                    this._json(modem._get_full_status())
                elif this.path == "/threat/status":
                    this._json({"threat_detected": False, "last_check": time.time()})
                elif this.path == "/tunnels":
                    this._json(modem._get_tunnel_status())
                elif this.path == "/health":
                    this._json({"status": "healthy", "uptime": int(time.time() - modem.start_time)})
                else:
                    this.send_error(404)
            
            def do_POST(this):
                cl = int(this.headers.get('Content-Length', 0))
                body = json.loads(this.rfile.read(cl)) if cl > 0 else {}
                
                if this.path == "/rotate":
                    modem._handle_rotation(body)
                    this._json({
                        "status": "rotated",
                        "imsi": modem.id.imsi[:6] + "***",
                        "count": modem.rotation_count
                    })
                    
                elif this.path == "/threat":
                    print("[Modem] ⚠️ Threat signal received!")
                    # Trigger emergency rotation with new identity
                    if modem.pool:
                        import random
                        new_id = random.choice(modem.pool)
                        modem.id = new_id
                        modem.rotation_count += 1
                    this._json({
                        "status": "emergency_rotation",
                        "imsi": modem.id.imsi[:6] + "***"
                    })
                    
                elif this.path == "/disconnect":
                    modem._disconnect_all_tunnels()
                    this._json({"status": "disconnected"})
                    
                elif this.path == "/connect":
                    tunnel_type = body.get("type", "socat")
                    if tunnel_type == "socks5":
                        modem._cmd_dial_socks("ATD*99***1#")
                    elif tunnel_type == "relay":
                        modem._cmd_dial_relay("ATD*99***2#")
                    else:
                        modem._cmd_dial_socat("ATD*99#")
                    this._json({"status": "connected", "type": tunnel_type})
                    
                else:
                    this.send_error(404)
            
            def _json(this, data):
                this.send_response(200)
                this.send_header("Content-Type", "application/json")
                this.send_header("Access-Control-Allow-Origin", "*")
                this.end_headers()
                this.wfile.write(json.dumps(data, indent=2).encode())
            
            def log_message(this, *args):
                pass  # Suppress HTTP access logs
        
        server = HTTPServer(('127.0.0.1', 9042), ModemAPI)
        print("[Modem] REST API: http://127.0.0.1:9042")
        server.serve_forever()
    
    def _handle_rotation(self, body: dict):
        """Process identity rotation request."""
        for key in ["imsi", "imei", "msisdn", "ki", "opc", "iccid"]:
            if key in body:
                setattr(self.id, key, body[key])
        self.rotation_count += 1
        print(f"[Modem] Identity rotated (#{self.rotation_count}): IMSI {self.id.imsi[:6]}***")
    
    def _get_full_status(self) -> dict:
        """Get complete modem status."""
        return {
            "modem": {
                "version": "4.0-termux",
                "uptime_seconds": int(time.time() - self.start_time),
                "pty_path": self.pty_path,
            },
            "identity": {
                "imsi": self.id.imsi[:6] + "***",
                "imei": self.id.imei[:8] + "***",
                "msisdn": self.id.msisdn,
                "operator": self.id.operator,
                "rotation_count": self.rotation_count,
            },
            "network": {
                "registered": self.registered,
                "signal_csq": self.signal,
                "data_active": self.data_active,
            },
            "tunnels": self._get_tunnel_status(),
            "esim": {
                "eid": self.esim.eid,
                "profiles_count": len(self.esim.profiles),
                "active_iccid": self.esim.active_iccid,
            },
            "vonr": self.vonr.get_status(),
            "wifi": self.wifi.get_status(),
            "antenna": self.antenna.get_status(),
            "henb": self.henb.get_status(),
        }
    
    def _get_tunnel_status(self) -> dict:
        """Get active tunnel information."""
        return {
            "active": self.data_active,
            "count": len(self.active_tunnels),
            "tunnels": [
                {
                    "port": t.port,
                    "type": t.tunnel_type,
                    "data_pty": t.data_pty,
                    "active": t.process is not None and t.process.poll() is None if t.process else True
                }
                for t in self.active_tunnels
            ]
        }
    
    # ── Lifecycle ────────────────────────────────────────────
    
    def start(self):
        """Start the virtual modem."""
        self.master_fd, self.slave_fd = pty.openpty()
        
        # Set terminal attributes
        import termios
        attrs = termios.tcgetattr(self.slave_fd)
        attrs[2] = attrs[2] | termios.B9600
        termios.tcsetattr(self.slave_fd, termios.TCSANOW, attrs)
        
        # Create symbolic link
        if os.path.exists(self.pty_path):
            os.unlink(self.pty_path)
        os.symlink(f"/dev/fd/{self.slave_fd}", self.pty_path)
        
        self.running = True
        self.start_time = time.time()
        
        print(f"\n{'='*60}")
        print(f"  SIF Enhanced Virtual Modem v4.0")
        print(f"  Termux-Compatible Edition")
        print(f"  {'='*60}")
        print(f"  PTY:      {self.pty_path}")
        print(f"  IMSI:     {self.id.imsi}")
        print(f"  IMEI:     {self.id.imei}")
        print(f"  Operator: {self.id.operator}")
        print(f"  eSIM EID: {self.esim.eid}")
        print(f"  Pool:     {len(self.pool)} identities")
        print(f"  {'='*60}")
        print(f"  Data modes: SOCAT tunnel, SOCKS5 proxy, TCP relay")
        print(f"  No PPP required — Termux compatible")
        print(f"  {'='*60}\n")
        
        # Start processing threads
        threading.Thread(target=self._at_loop, daemon=True, name="AT-Loop").start()
        threading.Thread(target=self._rest_api, daemon=True, name="REST-API").start()
    
    def stop(self):
        """Graceful shutdown."""
        print("[Modem] Shutting down...")
        self.running = False
        self._disconnect_all_tunnels()
        
        if self.master_fd:
            try:
                os.close(self.master_fd)
            except:
                pass
        if self.slave_fd:
            try:
                os.close(self.slave_fd)
            except:
                pass
        if os.path.exists(self.pty_path):
            try:
                os.unlink(self.pty_path)
            except:
                pass
        
        print("[Modem] Shutdown complete.")

# ═══════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="SIF Enhanced Virtual Modem — Termux Edition",
        epilog="No PPP required. Uses SOCAT tunnels, SOCKS5 proxy, and TCP relay."
    )
    parser.add_argument("--pty", default="/tmp/vmodem",
                        help="Pseudo-terminal path (default: /tmp/vmodem)")
    parser.add_argument("--identities", default=None,
                        help="JSON file with virtual identity pool")
    parser.add_argument("--port", type=int, default=9042,
                        help="REST API port (default: 9042)")
    
    args = parser.parse_args()
    
    # Create modem instance
    modem = EnhancedVirtualModem(
        pty_path=args.pty,
        identity_file=args.identities
    )
    
    # Handle graceful shutdown
    def signal_handler(sig, frame):
        print("\n[Modem] Received shutdown signal...")
        modem.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start modem
    modem.start()
    
    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        modem.stop()
        print("[Modem] Goodbye.")
