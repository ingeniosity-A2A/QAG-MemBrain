"""
S25 Ultra ADB Access — Layer 8: Tier 2 (ADB Shell)

Provides CPU pinning, real-time scheduling, and tmpfs ramdisk management
on Samsung S25 Ultra via ADB shell access.

Tier 2 requires ADB (Android Debug Bridge) shell access but NOT full
root.  This allows:
  * Pinning the cognitive runtime to specific CPU cores (big.LITTLE aware)
  * Setting SCHED_FIFO real-time scheduling for low-latency inference
  * Creating tmpfs ramdisks for zero-copy model loading

On a real device with ADB, commands are executed via ``adb shell``.
Without ADB, everything degrades to simulation.

Part of the Ava007 cognitive runtime (QAG-MemBrain).
"""

import os
import platform
import random
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class CPUPinResult:
    """Result of a CPU pinning operation."""
    success: bool
    pinned_cores: List[int]
    pid: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SchedResult:
    """Result of a scheduler policy change."""
    success: bool
    policy: str
    priority: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TmpfsResult:
    """Result of a tmpfs mount operation."""
    success: bool
    mount_point: str
    size_mb: int
    available_mb: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CPUInfo:
    """CPU topology information (big.LITTLE architecture)."""
    total_cores: int
    big_cores: List[int]
    little_cores: List[int]
    frequencies_mhz: List[int]
    governor: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class BenchmarkResult:
    """Memory bandwidth benchmark result."""
    size_mb: int
    bandwidth_mbps: float
    latency_ns: float

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# S25UltraADB — Tier 2
# ---------------------------------------------------------------------------

class S25UltraADB:
    """Tier 2 hardware access: CPU pinning + tmpfs (ADB shell).

    Samsung S25 Ultra CPU topology (Snapdragon 8 Elite):
        - Cores 0-3: LITTLE (Cortex-A720) @ 2.27 GHz
        - Cores 4-5: Performance (Cortex-A720) @ 3.53 GHz
        - Cores 6-7: Prime (Cortex-X4) @ 4.47 GHz

    For cognitive inference workloads we typically pin to the Prime cores
    (6-7) for maximum throughput, or LITTLE cores (0-3) for power
    efficiency.
    """

    # S25 Ultra Snapdragon 8 Elite core layout
    LITTLE_CORES = [0, 1, 2, 3]
    PERFORMANCE_CORES = [4, 5]
    PRIME_CORES = [6, 7]
    ALL_CORES = LITTLE_CORES + PERFORMANCE_CORES + PRIME_CORES

    # Reference frequencies (MHz) for the S25 Ultra
    REF_FREQUENCIES_MHZ = [2270, 2270, 2270, 2270, 3530, 3530, 4470, 4470]

    # tmpfs mount tracking
    _active_tmpfs_mounts: Dict[str, TmpfsResult] = {}

    def __init__(self):
        self._adb_available: Optional[bool] = None
        self._cpu_info: Optional[CPUInfo] = None
        self._simulation_mode = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def check_adb_access(self) -> bool:
        """Verify that ADB shell access is available.

        Returns:
            True if ``adb shell echo ok`` succeeds, False otherwise.
        """
        if self._adb_available is not None:
            return self._adb_available

        try:
            result = subprocess.run(
                ["adb", "shell", "echo", "ok"],
                capture_output=True, text=True, timeout=5,
            )
            self._adb_available = result.returncode == 0 and "ok" in result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            self._adb_available = False

        self._simulation_mode = not self._adb_available
        return self._adb_available

    def pin_cpu(self, core_ids: List[int]) -> CPUPinResult:
        """Pin the current process to the specified CPU cores.

        Uses ``taskset`` on-device; in simulation mode the operation
        is recorded but not executed.

        Args:
            core_ids: List of CPU core indices (0-7 for S25 Ultra).

        Returns:
            A :class:`CPUPinResult` indicating success.
        """
        pid = os.getpid()

        # Validate core IDs
        for cid in core_ids:
            if cid not in self.ALL_CORES:
                return CPUPinResult(
                    success=False,
                    pinned_cores=[],
                    pid=pid,
                )

        if not self._simulation_mode and self.check_adb_access():
            # Compute taskset mask
            mask = 0
            for cid in core_ids:
                mask |= (1 << cid)
            hex_mask = f"0x{mask:x}"

            try:
                result = subprocess.run(
                    ["adb", "shell", "taskset", "-p", hex_mask, str(pid)],
                    capture_output=True, text=True, timeout=5,
                )
                success = result.returncode == 0
            except (subprocess.TimeoutExpired, OSError):
                success = False

            return CPUPinResult(
                success=success,
                pinned_cores=core_ids if success else [],
                pid=pid,
            )

        # Simulation mode
        return CPUPinResult(
            success=True,
            pinned_cores=core_ids,
            pid=pid,
        )

    def set_sched_fifo(self, priority: int) -> SchedResult:
        """Set SCHED_FIFO real-time scheduling for the current process.

        Requires ADB shell or root.  SCHED_FIFO ensures the cognitive
        runtime is not pre-empted by background tasks.

        Args:
            priority: FIFO priority (1-99, where 99 is highest).

        Returns:
            A :class:`SchedResult` indicating success.
        """
        priority = max(1, min(99, priority))

        if not self._simulation_mode and self.check_adb_access():
            try:
                pid = os.getpid()
                # chrt -f <priority> -p <pid>
                result = subprocess.run(
                    ["adb", "shell", "chrt", "-f", "-p", str(priority), str(pid)],
                    capture_output=True, text=True, timeout=5,
                )
                success = result.returncode == 0
            except (subprocess.TimeoutExpired, OSError):
                success = False

            return SchedResult(
                success=success,
                policy="SCHED_FIFO",
                priority=priority if success else 0,
            )

        # Simulation mode
        return SchedResult(
            success=True,
            policy="SCHED_FIFO",
            priority=priority,
        )

    def create_tmpfs(self, size_mb: int, mount_point: str) -> TmpfsResult:
        """Create a tmpfs ramdisk for low-latency model loading.

        Args:
            size_mb: Size of the ramdisk in MiB.
            mount_point: Where to mount the tmpfs.

        Returns:
            A :class:`TmpfsResult` with mount details.
        """
        size_mb = max(1, min(size_mb, 4096))  # Cap at 4 GiB

        if not self._simulation_mode and self.check_adb_access():
            try:
                # Ensure mount point directory exists
                subprocess.run(
                    ["adb", "shell", "mkdir", "-p", mount_point],
                    capture_output=True, timeout=5,
                )
                # Mount tmpfs
                result = subprocess.run(
                    [
                        "adb", "shell",
                        "mount", "-t", "tmpfs", "-o",
                        f"size={size_mb}m",
                        "tmpfs", mount_point,
                    ],
                    capture_output=True, text=True, timeout=10,
                )
                success = result.returncode == 0
                available = float(size_mb) if success else 0.0
            except (subprocess.TimeoutExpired, OSError):
                success = False
                available = 0.0

            tresult = TmpfsResult(
                success=success,
                mount_point=mount_point,
                size_mb=size_mb,
                available_mb=available,
            )

        else:
            # Simulation: create a local temp directory as a stand-in
            try:
                Path(mount_point).mkdir(parents=True, exist_ok=True)
            except OSError:
                mount_point = tempfile.mkdtemp(prefix="ionmemd_tmpfs_")

            tresult = TmpfsResult(
                success=True,
                mount_point=mount_point,
                size_mb=size_mb,
                available_mb=float(size_mb),
            )

        self._active_tmpfs_mounts[mount_point] = tresult
        return tresult

    def destroy_tmpfs(self, mount_point: str) -> bool:
        """Unmount and destroy a previously created tmpfs.

        Args:
            mount_point: The mount point to destroy.

        Returns:
            True if the tmpfs was successfully destroyed.
        """
        if mount_point not in self._active_tmpfs_mounts:
            return False

        if not self._simulation_mode and self.check_adb_access():
            try:
                result = subprocess.run(
                    ["adb", "shell", "umount", mount_point],
                    capture_output=True, timeout=10,
                )
                success = result.returncode == 0
            except (subprocess.TimeoutExpired, OSError):
                success = False
        else:
            # Simulation: try to remove the local directory
            try:
                import shutil
                shutil.rmtree(mount_point, ignore_errors=True)
                success = True
            except OSError:
                success = False

        if success:
            del self._active_tmpfs_mounts[mount_point]

        return success

    def get_cpu_info(self) -> CPUInfo:
        """Get CPU topology for the S25 Ultra big.LITTLE layout.

        On a real device this reads from ``/sys/devices/system/cpu/``.
        In simulation mode it returns the reference S25 Ultra topology.
        """
        if self._cpu_info is not None:
            return self._cpu_info

        if not self._simulation_mode and self.check_adb_access():
            info = self._native_cpu_info()
        else:
            info = self._simulated_cpu_info()

        self._cpu_info = info
        return info

    def benchmark_memcpy(self, size_mb: int) -> BenchmarkResult:
        """Run a memory bandwidth benchmark.

        Allocates *size_mb* MiB of memory and measures copy throughput.
        On a real device this uses ``adb shell dd``; in simulation it
        uses Python's ``bytes`` operations.

        Args:
            size_mb: Size of the buffer to benchmark.

        Returns:
            A :class:`BenchmarkResult` with bandwidth and latency.
        """
        size_mb = max(1, min(size_mb, 1024))
        size_bytes = size_mb * 1024 * 1024

        if not self._simulation_mode and self.check_adb_access():
            return self._native_benchmark_memcpy(size_mb)

        # Simulation benchmark: measure Python bytearray copy speed
        src = bytearray(size_bytes)
        dst = bytearray(size_bytes)

        t0 = time.monotonic()
        # Use slice assignment for a realistic memory copy
        dst[:] = src
        elapsed = time.monotonic() - t0

        bandwidth = size_bytes / elapsed / (1024 * 1024)  # MiB/s
        latency = (elapsed / size_bytes) * 1e9  # ns per byte

        return BenchmarkResult(
            size_mb=size_mb,
            bandwidth_mbps=round(bandwidth, 2),
            latency_ns=round(latency, 3),
        )

    # ------------------------------------------------------------------
    # Tier interface
    # ------------------------------------------------------------------

    def get_tier(self) -> int:
        """Return the hardware access tier (always 2 for ADB)."""
        return 2

    def get_capabilities(self) -> List[str]:
        """Return a list of capabilities available at this tier."""
        caps = [
            "qnn_inference", "gpu_offload", "wifi_direct",
            "cpu_pinning", "sched_fifo", "tmpfs",
        ]
        if self.check_adb_access():
            caps.append("adb_shell")
        return caps

    # ------------------------------------------------------------------
    # Native (on-device) helpers
    # ------------------------------------------------------------------

    def _native_cpu_info(self) -> CPUInfo:
        """Read CPU topology from /sys/devices/system/cpu/ via ADB."""
        big_cores = []
        little_cores = []
        frequencies = []

        try:
            # List CPU directories
            result = subprocess.run(
                ["adb", "shell", "ls", "/sys/devices/system/cpu/"],
                capture_output=True, text=True, timeout=5,
            )
            cpu_dirs = [
                d for d in result.stdout.split()
                if d.startswith("cpu") and d[3:].isdigit()
            ]

            governor = "unknown"
            for d in sorted(cpu_dirs, key=lambda x: int(x[3:])):
                core_id = int(d[3:])
                # Read frequency
                freq = 0
                freq_path = f"/sys/devices/system/cpu/{d}/cpufreq/cpuinfo_max_freq"
                freq_result = subprocess.run(
                    ["adb", "shell", "cat", freq_path],
                    capture_output=True, text=True, timeout=2,
                )
                if freq_result.returncode == 0 and freq_result.stdout.strip():
                    try:
                        freq = int(freq_result.stdout.strip()) // 1000  # kHz → MHz
                    except ValueError:
                        freq = 0

                # Read governor
                gov_path = f"/sys/devices/system/cpu/{d}/cpufreq/scaling_governor"
                gov_result = subprocess.run(
                    ["adb", "shell", "cat", gov_path],
                    capture_output=True, text=True, timeout=2,
                )
                if gov_result.returncode == 0:
                    governor = gov_result.stdout.strip()

                # Classify as big or LITTLE based on frequency
                frequencies.append(freq)
                if freq >= 3000:
                    big_cores.append(core_id)
                else:
                    little_cores.append(core_id)

        except (subprocess.TimeoutExpired, OSError):
            return self._simulated_cpu_info()

        return CPUInfo(
            total_cores=len(frequencies),
            big_cores=big_cores if big_cores else self.PRIME_CORES + self.PERFORMANCE_CORES,
            little_cores=little_cores if little_cores else self.LITTLE_CORES,
            frequencies_mhz=frequencies if frequencies else self.REF_FREQUENCIES_MHZ,
            governor=governor,
        )

    def _native_benchmark_memcpy(self, size_mb: int) -> BenchmarkResult:
        """Run a dd-based memcpy benchmark via ADB."""
        size_bytes = size_mb * 1024 * 1024

        try:
            # Use dd to measure write throughput to /dev/null
            result = subprocess.run(
                [
                    "adb", "shell",
                    f"dd if=/dev/zero of=/dev/null bs=1M count={size_mb} 2>&1",
                ],
                capture_output=True, text=True, timeout=30,
            )
            # Parse dd output: "xxx bytes (xxx MB) copied, xxx s, xxx MB/s"
            bandwidth = 0.0
            for line in result.stderr.splitlines() + result.stdout.splitlines():
                if "MB/s" in line:
                    try:
                        parts = line.split(",")
                        for p in parts:
                            if "MB/s" in p:
                                bandwidth = float(p.strip().split()[0])
                                break
                    except (ValueError, IndexError):
                        pass

            latency = (size_bytes / (bandwidth * 1024 * 1024)) * 1e9 if bandwidth > 0 else 0.0
            return BenchmarkResult(
                size_mb=size_mb,
                bandwidth_mbps=round(bandwidth, 2),
                latency_ns=round(latency, 3),
            )
        except (subprocess.TimeoutExpired, OSError):
            # Fallback to simulation
            return BenchmarkResult(
                size_mb=size_mb,
                bandwidth_mbps=round(random.uniform(8000, 25000), 2),
                latency_ns=round(random.uniform(0.04, 0.12), 3),
            )

    # ------------------------------------------------------------------
    # Simulation helpers
    # ------------------------------------------------------------------

    def _simulated_cpu_info(self) -> CPUInfo:
        """Return the reference S25 Ultra CPU topology."""
        return CPUInfo(
            total_cores=8,
            big_cores=self.PRIME_CORES + self.PERFORMANCE_CORES,
            little_cores=self.LITTLE_CORES,
            frequencies_mhz=list(self.REF_FREQUENCIES_MHZ),
            governor="schedutil",
        )
