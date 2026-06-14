"""
QAG-MemBrain Hardware Layer — Layer 8: S25 Ultra Hardware Unlock

This package provides three tiers of hardware access for the Ava007
cognitive runtime on Samsung S25 Ultra (and S26 Ultra):

    Tier 1 (S25UltraNPU)  — QNN + GPU + Wi-Fi Direct  (no root)
    Tier 2 (S25UltraADB)  — CPU pinning + tmpfs       (ADB shell)
    Tier 3 (S25UltraRoot) — ionmemd + UFS mmap        (root)

Usage:

    from ava007.membrain.hardware import get_hardware_tier, S25UltraNPU

    tier = get_hardware_tier()       # Auto-detect highest available tier
    npu = S25UltraNPU()
    info = npu.detect_hardware()
    print(f"Running at tier {tier} on {info.device}")
"""

import os
import subprocess
from typing import Optional

from .s25ultra_npu import S25UltraNPU
from .s25ultra_adb import S25UltraADB
from .s25ultra_root import S25UltraRoot
from .ionmemd import IonmemdDaemon, IonmemdProtocol, MemoryRegion

__all__ = [
    "S25UltraNPU",
    "S25UltraADB",
    "S25UltraRoot",
    "IonmemdDaemon",
    "IonmemdProtocol",
    "MemoryRegion",
    "get_hardware_tier",
]


def get_hardware_tier() -> int:
    """Auto-detect the highest available hardware access tier.

    Detection order:
        1. Check root access  → Tier 3 (ionmemd + UFS mmap)
        2. Check ADB access   → Tier 2 (CPU pinning + tmpfs)
        3. Default            → Tier 1 (QNN + GPU + Wi-Fi Direct)

    Returns:
        Integer tier level (1, 2, or 3).
    """
    # --- Tier 3: Root access ---
    if _check_root():
        return 3

    # --- Tier 2: ADB shell access ---
    if _check_adb():
        return 2

    # --- Tier 1: Always available ---
    return 1


# ---------------------------------------------------------------------------
# Internal detection helpers
# ---------------------------------------------------------------------------

def _check_root() -> bool:
    """Check if root access is available."""
    # Method 1: Are we running as root?
    try:
        if os.geteuid() == 0:
            return True
    except AttributeError:
        pass  # Windows / non-POSIX

    # Method 2: Can we execute `su -c id` and get uid=0?
    try:
        result = subprocess.run(
            ["su", "-c", "id"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and "uid=0" in result.stdout:
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # Method 3: Can we use `adb root`?
    try:
        result = subprocess.run(
            ["adb", "root"],
            capture_output=True, text=True, timeout=5,
        )
        if "already running as root" in result.stdout:
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    return False


def _check_adb() -> bool:
    """Check if ADB shell access is available."""
    try:
        result = subprocess.run(
            ["adb", "shell", "echo", "ok"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0 and "ok" in result.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return False
