#!/usr/bin/env python3
"""
IMSI-Catcher Detection & Response Module
========================================
Monitors for Stingray/IMSI-catcher activity using gr-gsm.
Triggers emergency identity rotation on detection.

Prerequisites: gr-gsm, GNU Radio, RTL-SDR or sSDR hardware
License: MIT
"""

import subprocess
import json
import requests
import time
import threading
import os
from datetime import datetime
from typing import List, Dict

class StingrayDetector:
    """Detects IMSI-catchers and triggers countermeasures."""
    
    def __init__(self, chameleon_endpoint: str = "http://localhost:9042/threat"):
        self.endpoint = chameleon_endpoint
        self.suspicious_cells: List[Dict] = []
        self.detection_count = 0
        self.last_detection: float = 0
        self.cooldown_period = 30  # seconds between threat reports
        self.running = False
        
        # Anomaly scoring thresholds
        self.thresholds = {
            "rssi_jump_db": 20,        # Sudden RSSI increase
            "lac_change_rate": 5,       # LAC changes per minute
            "cell_reselection_ms": 500, # Unusually fast reselection
            "cipher_downgrade": True,   # A5/0 or A5/1 forced
        }
    
    def scan_arfcn(self, arfcn_range: tuple = (1, 66536)) -> List[Dict]:
        """
        Scan ARFCN range for anomalous cell behavior.
        Uses gr-gsm for GSM/UMTS bands, extendable to LTE/NR.
        
        Returns list of suspicious cell reports.
        """
        suspicious = []
        
        try:
            # Run gr-gsm scan (requires gr-gsm installation)
            cmd = [
                "python3", "-m", "imsi_catcher",
                "--scan", "--band", "GSM900,GSM1800",
                "--threshold", str(self.thresholds["rssi_jump_db"])
            ]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30
            )
            
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "ANOMALY" in line or "SUSPICIOUS" in line:
                    cell_data = self._parse_cell_line(line)
                    if cell_data:
                        suspicious.append(cell_data)
                        print(f"[!] Anomalous cell: {cell_data}")
                        
        except subprocess.TimeoutExpired:
            print("[!] Scan timeout — possible jamming?")
        except FileNotFoundError:
            print("[!] gr-gsm not installed. Install with:")
            print("    apt install gr-gsm")
        except Exception as e:
            print(f"[!] Scan error: {e}")
        
        return suspicious
    
    def _parse_cell_line(self, line: str) -> Dict:
        """Parse a cell detection line into structured data."""
        return {
            "timestamp": datetime.now().isoformat(),
            "raw": line,
            "arfcn": self._extract_field(line, "ARFCN"),
            "rssi": self._extract_field(line, "RSSI"),
            "mcc": self._extract_field(line, "MCC"),
            "mnc": self._extract_field(line, "MNC"),
            "lac": self._extract_field(line, "LAC"),
            "cell_id": self._extract_field(line, "CID"),
        }
    
    def _extract_field(self, line: str, field: str) -> str:
        """Extract a field value from detection line."""
        import re
        match = re.search(rf'{field}[=:]\s*(\S+)', line, re.IGNORECASE)
        return match.group(1) if match else "unknown"
    
    def report_threat(self, cell_data: Dict):
        """
        Report detected IMSI-catcher to Chameleon Controller.
        Includes cooldown to prevent flood.
        """
        now = time.time()
        if now - self.last_detection < self.cooldown_period:
            return  # Still in cooldown
        
        self.last_detection = now
        self.detection_count += 1
        
        print(f"\n{'!'*60}")
        print(f"  ⚠️  IMSI-CATCHER DETECTED (#{self.detection_count})")
        print(f"  Time: {datetime.now().isoformat()}")
        print(f"  Cell: ARFCN {cell_data.get('arfcn', '?')}")
        print(f"  RSSI: {cell_data.get('rssi', '?')}")
        print(f"  MCC/MNC: {cell_data.get('mcc', '?')}/{cell_data.get('mnc', '?')}")
        print(f"{'!'*60}\n")
        
        # Trigger emergency rotation
        try:
            response = requests.post(
                self.endpoint,
                json={
                    "trigger": "imsi_catcher",
                    "cell_info": cell_data,
                    "detection_count": self.detection_count,
                    "timestamp": datetime.now().isoformat(),
                },
                timeout=5
            )
            if response.status_code == 200:
                print("[✓] Threat reported to Chameleon Controller")
            else:
                print(f"[✗] Controller returned {response.status_code}")
        except requests.exceptions.ConnectionError:
            print("[✗] Cannot reach Chameleon Controller (port 9042)")
        except Exception as e:
            print(f"[✗] Report error: {e}")
    
    def start_continuous_monitoring(self, interval: int = 5):
        """Start background monitoring thread."""
        self.running = True
        
        def monitor_loop():
            print("[Monitor] IMSI-catcher detection active")
            print("[Monitor] Scanning every", interval, "seconds")
            while self.running:
                try:
                    suspicious = self.scan_arfcn()
                    for cell in suspicious:
                        self.report_threat(cell)
                except Exception as e:
                    print(f"[Monitor] Scan error: {e}")
                time.sleep(interval)
        
        self.monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        self.monitor_thread.start()
    
    def stop(self):
        """Stop monitoring."""
        self.running = False
        print("[Monitor] Detection stopped.")
    
    def get_status(self) -> Dict:
        """Return current detection status."""
        return {
            "active": self.running,
            "detections": self.detection_count,
            "last_detection": datetime.fromtimestamp(self.last_detection).isoformat()
                if self.last_detection else None,
            "cooldown": self.cooldown_period,
        }


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="SIF IMSI-Catcher Detector")
    parser.add_argument("--endpoint", default="http://localhost:9042/threat")
    parser.add_argument("--interval", type=int, default=5)
    args = parser.parse_args()
    
    detector = StingrayDetector(chameleon_endpoint=args.endpoint)
    detector.start_continuous_monitoring(interval=args.interval)
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        detector.stop()
        print("\n[Monitor] Shutdown complete.")
