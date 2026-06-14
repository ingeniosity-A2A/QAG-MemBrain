# Layer 8: S25 Ultra Hardware Unlock

QAG-MemBrain hardware abstraction layer for the Ava007 cognitive runtime.

Provides three tiers of hardware access on Samsung S25 Ultra (SM-S938B,
Snapdragon 8 Elite) and S26 Ultra, from basic NPU access to full
root-level ionmemd daemon control.  Each tier progressively unlocks
more hardware capabilities.  All tiers degrade gracefully to simulation
mode when the required access level is not available.

## Architecture

```
┌──────────────────────────────────────────────────┐
│              Ava007 Cognitive Runtime             │
├──────────────────────────────────────────────────┤
│            hardware/__init__.py                   │
│            get_hardware_tier() → 1|2|3           │
├────────────┬────────────┬────────────────────────┤
│  Tier 1    │  Tier 2    │  Tier 3                │
│  No Root   │  ADB Shell │  Root                  │
│            │            │                        │
│  QNN (NPU) │  CPU Pin   │  ionmemd Daemon       │
│  Adreno GPU│  SCHED_FIFO│  UFS mmap             │
│  Wi-Fi Dir │  tmpfs     │  Physical Memory R/W  │
│            │            │  DMA Monitor           │
├────────────┴────────────┴────────────────────────┤
│              ionmemd/ (IPC daemon)                │
│  protocol.py  ·  daemon.py                       │
│  [4-byte len][JSON] over Unix socket             │
└──────────────────────────────────────────────────┘
```

## Tiers

### Tier 1 — No Root (`S25UltraNPU`)

Available everywhere — even on non-Samsung hosts (simulation mode).

| Capability | Method | Notes |
|---|---|---|
| QNN inference | `inference_qnn()` | HTP → GPU → CPU backend fallback |
| GPU offload | `gpu_offload()` | matmul, FFT, softmax, reduce_sum |
| Wi-Fi Direct | `wifi_direct_scan/connect/send()` | P2P mesh networking |

### Tier 2 — ADB Shell (`S25UltraADB`)

Requires ADB debug access (`adb shell`).

| Capability | Method | Notes |
|---|---|---|
| CPU pinning | `pin_cpu()` | big.LITTLE aware (cores 0-7) |
| Real-time sched | `set_sched_fifo()` | SCHED_FIFO priority 1-99 |
| tmpfs ramdisk | `create_tmpfs() / destroy_tmpfs()` | Zero-copy model loading |
| Memory benchmark | `benchmark_memcpy()` | Bandwidth measurement |

### Tier 3 — Root (`S25UltraRoot`)

Requires full root (Magisk / su / `adb root`).

| Capability | Method | Notes |
|---|---|---|
| ionmemd control | `start_ionmemd() / stop_ionmemd()` | ION memory daemon |
| UFS mmap | `mmap_ufs_region() / unmap_ufs_region()` | Zero-copy storage access |
| Physical memory | `read_physical_memory() / write_physical_memory()` | Via ionmemd IPC |
| DMA status | `get_dma_status()` | Channel monitor |

## Quick Start

```python
from ava007.membrain.hardware import get_hardware_tier, S25UltraNPU

# Auto-detect the highest available tier
tier = get_hardware_tier()
print(f"Hardware tier: {tier}")

# Tier 1 — always works
npu = S25UltraNPU()
info = npu.detect_hardware()
print(f"Device: {info.device}, NPU: {info.npu_available}")

handle = npu.initialize_qnn()
result = npu.inference_qnn([1.0, 2.0, 3.0, 4.0], handle)
print(f"Inference: {result.output} in {result.latency_ms} ms")

# Tier 2 — if ADB is available
if tier >= 2:
    from ava007.membrain.hardware import S25UltraADB
    adb = S25UltraADB()
    cpu = adb.get_cpu_info()
    print(f"Big cores: {cpu.big_cores}, LITTLE cores: {cpu.little_cores}")
    adb.pin_cpu(cpu.big_cores)  # Pin to Prime + Perf cores

# Tier 3 — if root is available
if tier >= 3:
    from ava007.membrain.hardware import S25UltraRoot
    root = S25UltraRoot()
    handle = root.start_ionmemd()
    mapping = root.mmap_ufs_region(offset=0, size=4096)
    data = root.read_physical_memory(address=0, size=256)
```

## ionmemd Daemon

The ION memory daemon manages physical memory allocation for the
cognitive runtime.  It communicates over a Unix-domain socket using
a length-prefixed JSON protocol:

```
Wire format: [4 bytes: big-endian uint32 length][JSON payload]

Commands: ALLOCATE, FREE, READ, WRITE, LIST, INFO, PING, SHUTDOWN
Protocol version: 1.0
```

```python
from ava007.membrain.hardware.ionmemd import IonmemdDaemon, IonmemdProtocol

# Start the daemon (in-process simulation)
daemon = IonmemdDaemon()
daemon.start()

# Allocate a region
region = daemon.allocate_region(65536)
print(f"Region {region.id}: {region.size} bytes at offset {region.offset}")

# Write and read
daemon.write_region(region.id, 0, b"Hello, ionmemd!")
data = daemon.read_region(region.id, 0, 16)
print(data)  # b"Hello, ionmemd!"

# IPC protocol
frame = IonmemdProtocol.build_request("PING", {})
print(IonmemdProtocol.parse_request(frame))
```

## File Layout

```
hardware/
├── __init__.py          # Package init, get_hardware_tier()
├── README.md            # This file
├── s25ultra_npu.py      # Tier 1: QNN + GPU + Wi-Fi Direct
├── s25ultra_adb.py      # Tier 2: CPU pinning + tmpfs
├── s25ultra_root.py     # Tier 3: ionmemd + UFS mmap
└── ionmemd/
    ├── __init__.py      # Exports: IonmemdDaemon, IonmemdProtocol, MemoryRegion
    ├── daemon.py        # ionmemd daemon implementation
    └── protocol.py      # IPC protocol (length-prefixed JSON)
```

## Dependencies

Python stdlib only — no external packages required.

- `subprocess` — ADB / su command execution
- `socket` — Unix-domain IPC for ionmemd
- `struct` — Binary frame encoding
- `mmap` — UFS and /dev/mem mapping
- `json` — Protocol serialization
- `uuid` — Request / region ID generation
- `dataclasses` — Structured return types
- `threading` — Daemon accept loop
- `tempfile`, `pathlib` — Simulation file management
