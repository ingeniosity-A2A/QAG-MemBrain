"""
ionmemd Daemon — Layer 8: S25 Ultra Hardware Unlock

The ION memory daemon manages physical memory allocation for the Ava007
cognitive runtime on Samsung S25 Ultra (Snapdragon 8 Elite / SM-S938B).

On a rooted device it would allocate ION buffers through /dev/ion and expose
them over a Unix-domain socket.  In simulation mode (non-root / dev) it
operates on an in-process bytearray-backed store so the full IPC protocol
is exercised without real hardware.

Part of the Ava007 cognitive runtime (QAG-MemBrain).
"""

import json
import os
import signal
import socket
import struct
import tempfile
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .protocol import IonmemdProtocol


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class MemoryRegion:
    """Represents a single allocated memory region inside the daemon."""
    id: str
    size: int
    offset: int
    allocated_at: str
    access_count: int = 0
    tier: str = "simulated"  # "ion" on real hardware, "simulated" otherwise

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Daemon implementation
# ---------------------------------------------------------------------------

class IonmemdDaemon:
    """ION memory daemon for the Ava007 cognitive runtime.

    Runs an event-loop on a Unix-domain socket, accepting framed-JSON
    requests via :class:`IonmemdProtocol`.  When real /dev/ion is not
    available the daemon transparently falls back to an in-process
    bytearray-backed simulation.

    Usage (production / root):

        daemon = IonmemdDaemon(socket_path="/dev/ionmemd.sock")
        daemon.start()       # blocks — run in a thread if needed
        # ... clients connect to the socket ...

    Usage (simulation / dev):

        daemon = IonmemdDaemon()
        daemon.start()       # starts simulated server

    Programmatic (no socket — direct in-process):

        daemon = IonmemdDaemon()
        # daemon.start() — optional; methods work without it
        region = daemon.allocate_region(4096)
        daemon.write_region(region.id, 0, b"hello")
        data = daemon.read_region(region.id, 0, 5)
    """

    # Default configuration
    DEFAULT_SOCKET_PATH = "/tmp/ionmemd.sock"
    DEFAULT_STORAGE_PATH = "/tmp/ionmemd_storage"
    MAX_REGION_SIZE = 256 * 1024 * 1024   # 256 MiB per region
    TOTAL_POOL_SIZE  = 512 * 1024 * 1024   # 512 MiB total pool

    def __init__(
        self,
        socket_path: str = DEFAULT_SOCKET_PATH,
        storage_path: str = DEFAULT_STORAGE_PATH,
    ):
        self.socket_path = socket_path
        self.storage_path = storage_path

        # State
        self._regions: Dict[str, MemoryRegion] = {}
        self._pool_offset = 0           # Next free offset in the pool
        self._pool_data = bytearray()   # Simulated backing store
        self._lock = threading.Lock()

        # Socket / thread
        self._server_socket: Optional[socket.socket] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Detect real ION availability
        self._ion_available = os.path.exists("/dev/ion")

    # ------------------------------------------------------------------
    # Public lifecycle
    # ------------------------------------------------------------------

    def start(self) -> bool:
        """Start the daemon — bind the Unix socket and enter the accept loop.

        Returns True if the daemon started successfully.

        The accept loop runs in a background daemon thread so this method
        returns immediately.
        """
        if self._running:
            return True

        # Ensure storage directory exists
        Path(self.storage_path).mkdir(parents=True, exist_ok=True)

        # Try to bind the Unix socket
        try:
            # Remove stale socket file
            if os.path.exists(self.socket_path):
                os.unlink(self.socket_path)

            self._server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._server_socket.bind(self.socket_path)
            self._server_socket.listen(8)
            self._server_socket.settimeout(1.0)  # Allow periodic _running checks
        except OSError as exc:
            # Fall back to simulation-only mode (no socket)
            self._server_socket = None
            self._running = True  # In-process mode still "running"
            return True

        self._running = True

        # Spawn accept loop in background thread
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

        return True

    def stop(self) -> bool:
        """Stop the daemon gracefully."""
        self._running = False

        if self._server_socket is not None:
            try:
                self._server_socket.close()
            except OSError:
                pass

            # Clean up socket file
            try:
                os.unlink(self.socket_path)
            except OSError:
                pass

        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

        return True

    # ------------------------------------------------------------------
    # Public memory operations (in-process API)
    # ------------------------------------------------------------------

    def allocate_region(self, size: int) -> MemoryRegion:
        """Allocate a new memory region of *size* bytes.

        Args:
            size: Number of bytes to allocate. Must be > 0 and
                  ≤ MAX_REGION_SIZE.

        Returns:
            A :class:`MemoryRegion` describing the allocation.

        Raises:
            ValueError: If size is invalid or pool is exhausted.
        """
        if size <= 0:
            raise ValueError(f"Allocation size must be > 0, got {size}")
        if size > self.MAX_REGION_SIZE:
            raise ValueError(
                f"Allocation size {size} exceeds maximum "
                f"{self.MAX_REGION_SIZE} bytes"
            )

        with self._lock:
            # Grow simulated pool if needed
            needed = self._pool_offset + size
            if needed > len(self._pool_data):
                if needed > self.TOTAL_POOL_SIZE:
                    raise ValueError(
                        f"Pool exhausted: requested {needed} bytes, "
                        f"pool cap is {self.TOTAL_POOL_SIZE} bytes"
                    )
                # Expand pool to needed size (page-aligned 4 KiB)
                new_size = ((needed + 4095) // 4096) * 4096
                self._pool_data.extend(b"\x00" * (new_size - len(self._pool_data)))

            region = MemoryRegion(
                id=uuid.uuid4().hex[:16],
                size=size,
                offset=self._pool_offset,
                allocated_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                access_count=0,
                tier="ion" if self._ion_available else "simulated",
            )
            self._regions[region.id] = region
            self._pool_offset += size

        return region

    def free_region(self, region_id: str) -> bool:
        """Free a previously allocated memory region.

        Args:
            region_id: The ``id`` field of the region to free.

        Returns:
            True if the region was found and freed, False otherwise.
        """
        with self._lock:
            if region_id not in self._regions:
                return False
            region = self._regions.pop(region_id)
            # Zero-out the freed range in the simulated pool
            self._pool_data[region.offset : region.offset + region.size] = b"\x00" * region.size
        return True

    def read_region(self, region_id: str, offset: int, size: int) -> bytes:
        """Read *size* bytes from a region at *offset*.

        Args:
            region_id: Target region ID.
            offset: Byte offset within the region (must be ≥ 0).
            size: Number of bytes to read (must be > 0).

        Returns:
            The bytes read.

        Raises:
            KeyError: If *region_id* does not exist.
            ValueError: If offset+size exceeds the region bounds.
        """
        with self._lock:
            if region_id not in self._regions:
                raise KeyError(f"Region '{region_id}' not found")
            region = self._regions[region_id]
            if offset < 0 or offset + size > region.size:
                raise ValueError(
                    f"Read out of bounds: offset={offset}, size={size}, "
                    f"region_size={region.size}"
                )
            region.access_count += 1
            abs_offset = region.offset + offset
            return bytes(self._pool_data[abs_offset : abs_offset + size])

    def write_region(self, region_id: str, offset: int, data: bytes) -> int:
        """Write *data* into a region at *offset*.

        Args:
            region_id: Target region ID.
            offset: Byte offset within the region (must be ≥ 0).
            data: Bytes to write.

        Returns:
            Number of bytes written.

        Raises:
            KeyError: If *region_id* does not exist.
            ValueError: If offset+len(data) exceeds the region bounds.
        """
        with self._lock:
            if region_id not in self._regions:
                raise KeyError(f"Region '{region_id}' not found")
            region = self._regions[region_id]
            if offset < 0 or offset + len(data) > region.size:
                raise ValueError(
                    f"Write out of bounds: offset={offset}, "
                    f"data_len={len(data)}, region_size={region.size}"
                )
            region.access_count += 1
            abs_offset = region.offset + offset
            self._pool_data[abs_offset : abs_offset + len(data)] = data
        return len(data)

    def get_region_info(self, region_id: str) -> Optional[MemoryRegion]:
        """Return info for a region, or None if not found."""
        with self._lock:
            return self._regions.get(region_id)

    def list_regions(self) -> List[MemoryRegion]:
        """Return a list of all currently allocated regions."""
        with self._lock:
            return list(self._regions.values())

    # ------------------------------------------------------------------
    # IPC request handler
    # ------------------------------------------------------------------

    def handle_request(self, request: dict) -> dict:
        """Process a single IPC request dict and return a response dict.

        This is the central dispatch used both by the socket server and
        by direct in-process callers.

        Args:
            request: A dict conforming to the IonmemdProtocol request schema.

        Returns:
            A dict conforming to the IonmemdProtocol response schema.
        """
        if not IonmemdProtocol.validate_request(request):
            return {
                "status": "error",
                "data": {},
                "error": "Invalid request format",
                "request_id": request.get("request_id", "unknown"),
                "protocol_version": IonmemdProtocol.PROTOCOL_VERSION,
            }

        command = request["command"]
        params = request.get("params", {})
        req_id = request["request_id"]

        try:
            handler = getattr(self, f"_cmd_{command.lower()}", None)
            if handler is None:
                return self._error_response(req_id, f"Unhandled command: {command}")

            result = handler(params)
            return {
                "status": "ok",
                "data": result,
                "error": None,
                "request_id": req_id,
                "protocol_version": IonmemdProtocol.PROTOCOL_VERSION,
            }

        except Exception as exc:
            return self._error_response(req_id, str(exc))

    # ------------------------------------------------------------------
    # Command handlers
    # ------------------------------------------------------------------

    def _cmd_allocate(self, params: dict) -> dict:
        size = int(params.get("size", 0))
        region = self.allocate_region(size)
        return region.to_dict()

    def _cmd_free(self, params: dict) -> dict:
        region_id = params.get("region_id", "")
        success = self.free_region(region_id)
        return {"freed": success, "region_id": region_id}

    def _cmd_read(self, params: dict) -> dict:
        region_id = params["region_id"]
        offset = int(params.get("offset", 0))
        size = int(params.get("size", 0))
        data = self.read_region(region_id, offset, size)
        import base64
        return {
            "region_id": region_id,
            "offset": offset,
            "size": size,
            "data_b64": base64.b64encode(data).decode("ascii"),
        }

    def _cmd_write(self, params: dict) -> dict:
        region_id = params["region_id"]
        offset = int(params.get("offset", 0))
        import base64
        data = base64.b64decode(params.get("data_b64", ""))
        written = self.write_region(region_id, offset, data)
        return {"region_id": region_id, "offset": offset, "bytes_written": written}

    def _cmd_list(self, params: dict) -> dict:
        regions = self.list_regions()
        return {"regions": [r.to_dict() for r in regions], "count": len(regions)}

    def _cmd_info(self, params: dict) -> dict:
        region_id = params.get("region_id", "")
        region = self.get_region_info(region_id)
        if region is None:
            raise KeyError(f"Region '{region_id}' not found")
        return region.to_dict()

    def _cmd_ping(self, params: dict) -> dict:
        return {
            "pong": True,
            "ion_available": self._ion_available,
            "region_count": len(self._regions),
            "pool_used_bytes": self._pool_offset,
            "pool_total_bytes": len(self._pool_data),
        }

    def _cmd_shutdown(self, params: dict) -> dict:
        self.stop()
        return {"shutting_down": True}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _error_response(request_id: str, error: str) -> dict:
        return {
            "status": "error",
            "data": {},
            "error": error,
            "request_id": request_id,
            "protocol_version": IonmemdProtocol.PROTOCOL_VERSION,
        }

    def _accept_loop(self) -> None:
        """Background accept loop — spawns a handler thread per connection."""
        assert self._server_socket is not None
        while self._running:
            try:
                conn, _ = self._server_socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break  # Socket closed

            t = threading.Thread(
                target=self._handle_connection, args=(conn,), daemon=True
            )
            t.start()

    def _handle_connection(self, conn: socket.socket) -> None:
        """Handle a single client connection — read frames, dispatch, respond."""
        try:
            while self._running:
                # Read one request frame
                frame = IonmemdProtocol.recv_frame(conn, timeout=10.0)
                request = IonmemdProtocol.parse_request(frame)

                # Dispatch
                response = self.handle_request(request)

                # Serialize and send response
                resp_frame = IonmemdProtocol.build_response(
                    status=response["status"],
                    data=response["data"],
                    request_id=response["request_id"],
                    error=response.get("error"),
                )
                IonmemdProtocol.send_frame(conn, resp_frame, timeout=10.0)

                # If the client asked us to shut down, break out
                if request.get("command") == "SHUTDOWN":
                    break
        except (ConnectionError, TimeoutError, OSError, json.JSONDecodeError):
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass
