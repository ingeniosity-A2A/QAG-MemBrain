"""
ionmemd — ION Memory Daemon sub-package (Layer 8)

Exports:
    IonmemdDaemon   — The daemon class that manages memory regions.
    IonmemdProtocol — The binary-framed JSON IPC protocol.
    MemoryRegion    — Dataclass for an allocated memory region.
"""

from .daemon import IonmemdDaemon, MemoryRegion
from .protocol import IonmemdProtocol

__all__ = ["IonmemdDaemon", "IonmemdProtocol", "MemoryRegion"]
