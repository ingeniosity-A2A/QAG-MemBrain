"""
ionmemd IPC Protocol — Layer 8: S25 Ultra Hardware Unlock

Binary-framed JSON protocol for communicating with the ionmemd daemon.
Frame format: [4-byte big-endian length][JSON payload]

Protocol version: 1.0
Commands: ALLOCATE, FREE, READ, WRITE, LIST, INFO, PING, SHUTDOWN

Part of the Ava007 cognitive runtime (QAG-MemBrain).
"""

import json
import struct
import uuid
from typing import Any, Dict, Optional


class IonmemdProtocol:
    """IPC protocol handler for ionmemd daemon communication.

    Wire format:
        [4 bytes: payload length (big-endian uint32)][JSON payload bytes]

    Request schema:
        {
            "command": str,          # One of the COMMANDS below
            "params": dict,          # Command-specific parameters
            "request_id": str,       # Unique request identifier (UUID4)
            "protocol_version": str  # "1.0"
        }

    Response schema:
        {
            "status": str,           # "ok" or "error"
            "data": dict,            # Response payload
            "error": str | null,     # Error message if status == "error"
            "request_id": str,       # Echoes the request's request_id
            "protocol_version": str  # "1.0"
        }
    """

    PROTOCOL_VERSION = "1.0"
    HEADER_SIZE = 4  # uint32 length prefix

    COMMANDS = frozenset({
        "ALLOCATE",
        "FREE",
        "READ",
        "WRITE",
        "LIST",
        "INFO",
        "PING",
        "SHUTDOWN",
    })

    # ------------------------------------------------------------------
    # Request builders / parsers
    # ------------------------------------------------------------------

    @staticmethod
    def build_request(command: str, params: Optional[Dict[str, Any]] = None) -> bytes:
        """Serialize an IPC request into a length-prefixed binary frame.

        Args:
            command: One of the valid COMMANDS.
            params: Optional dict of command-specific parameters.

        Returns:
            bytes: 4-byte length header + JSON payload.

        Raises:
            ValueError: If *command* is not a recognised command.
        """
        if command not in IonmemdProtocol.COMMANDS:
            raise ValueError(
                f"Unknown command '{command}'. "
                f"Valid commands: {sorted(IonmemdProtocol.COMMANDS)}"
            )

        request: Dict[str, Any] = {
            "command": command,
            "params": params if params is not None else {},
            "request_id": uuid.uuid4().hex,
            "protocol_version": IonmemdProtocol.PROTOCOL_VERSION,
        }

        payload = json.dumps(request, separators=(",", ":")).encode("utf-8")
        header = struct.pack("!I", len(payload))
        return header + payload

    @staticmethod
    def parse_request(data: bytes) -> Dict[str, Any]:
        """Deserialize a raw IPC frame into a request dict.

        Args:
            data: The complete frame *including* the 4-byte header.

        Returns:
            Parsed request dictionary.

        Raises:
            ValueError: If the frame is too short or payload is not valid JSON.
        """
        if len(data) < IonmemdProtocol.HEADER_SIZE:
            raise ValueError(
                f"Frame too short: got {len(data)} bytes, "
                f"need at least {IonmemdProtocol.HEADER_SIZE}"
            )

        payload_len = struct.unpack("!I", data[: IonmemdProtocol.HEADER_SIZE])[0]
        payload_bytes = data[IonmemdProtocol.HEADER_SIZE : IonmemdProtocol.HEADER_SIZE + payload_len]

        if len(payload_bytes) < payload_len:
            raise ValueError(
                f"Incomplete payload: expected {payload_len} bytes, "
                f"got {len(payload_bytes)}"
            )

        request = json.loads(payload_bytes.decode("utf-8"))
        return request

    # ------------------------------------------------------------------
    # Response builders / parsers
    # ------------------------------------------------------------------

    @staticmethod
    def build_response(
        status: str,
        data: Dict[str, Any],
        request_id: str,
        error: Optional[str] = None,
    ) -> bytes:
        """Serialize an IPC response into a length-prefixed binary frame.

        Args:
            status: "ok" or "error".
            data: Response payload dict.
            request_id: Echoes the originating request's ID.
            error: Optional error message when status == "error".

        Returns:
            bytes: 4-byte length header + JSON payload.
        """
        response: Dict[str, Any] = {
            "status": status,
            "data": data,
            "error": error,
            "request_id": request_id,
            "protocol_version": IonmemdProtocol.PROTOCOL_VERSION,
        }

        payload = json.dumps(response, separators=(",", ":")).encode("utf-8")
        header = struct.pack("!I", len(payload))
        return header + payload

    @staticmethod
    def parse_response(data: bytes) -> Dict[str, Any]:
        """Deserialize a raw IPC frame into a response dict.

        Args:
            data: The complete frame *including* the 4-byte header.

        Returns:
            Parsed response dictionary.

        Raises:
            ValueError: If the frame is malformed.
        """
        if len(data) < IonmemdProtocol.HEADER_SIZE:
            raise ValueError(
                f"Frame too short: got {len(data)} bytes, "
                f"need at least {IonmemdProtocol.HEADER_SIZE}"
            )

        payload_len = struct.unpack("!I", data[: IonmemdProtocol.HEADER_SIZE])[0]
        payload_bytes = data[IonmemdProtocol.HEADER_SIZE : IonmemdProtocol.HEADER_SIZE + payload_len]

        if len(payload_bytes) < payload_len:
            raise ValueError(
                f"Incomplete payload: expected {payload_len} bytes, "
                f"got {len(payload_bytes)}"
            )

        response = json.loads(payload_bytes.decode("utf-8"))
        return response

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    @staticmethod
    def validate_request(request: Dict[str, Any]) -> bool:
        """Validate that *request* conforms to the protocol schema.

        Returns:
            True if the request is well-formed, False otherwise.
        """
        if not isinstance(request, dict):
            return False

        # Required top-level keys
        required_keys = {"command", "params", "request_id", "protocol_version"}
        if not required_keys.issubset(request.keys()):
            return False

        # Command must be a known command
        if request["command"] not in IonmemdProtocol.COMMANDS:
            return False

        # Params must be a dict
        if not isinstance(request["params"], dict):
            return False

        # request_id must be a non-empty string
        if not isinstance(request["request_id"], str) or not request["request_id"]:
            return False

        # protocol_version must match
        if request["protocol_version"] != IonmemdProtocol.PROTOCOL_VERSION:
            return False

        return True

    # ------------------------------------------------------------------
    # Streaming helpers — read exactly one frame from a socket
    # ------------------------------------------------------------------

    @staticmethod
    def recv_frame(sock, timeout: float = 5.0) -> bytes:
        """Read one length-prefixed frame from *sock*.

        Args:
            sock: A connected socket.socket (AF_UNIX or AF_INET).
            timeout: Per-recv timeout in seconds.

        Returns:
            The complete frame (header + payload) as bytes.

        Raises:
            ConnectionError: If the peer closes the connection.
            TimeoutError: If the recv exceeds *timeout*.
        """
        import socket as _socket

        sock.settimeout(timeout)

        # Read the 4-byte header
        header = b""
        while len(header) < IonmemdProtocol.HEADER_SIZE:
            chunk = sock.recv(IonmemdProtocol.HEADER_SIZE - len(header))
            if not chunk:
                raise ConnectionError("Peer closed connection while reading header")
            header += chunk

        payload_len = struct.unpack("!I", header)[0]

        # Sanity: cap at 64 MiB to prevent OOM on corrupt frames
        if payload_len > 64 * 1024 * 1024:
            raise ValueError(f"Payload length {payload_len} exceeds 64 MiB safety cap")

        # Read the payload
        payload = b""
        while len(payload) < payload_len:
            chunk = sock.recv(min(payload_len - len(payload), 65536))
            if not chunk:
                raise ConnectionError("Peer closed connection while reading payload")
            payload += chunk

        return header + payload

    @staticmethod
    def send_frame(sock, frame: bytes, timeout: float = 5.0) -> None:
        """Send one length-prefixed frame over *sock*.

        Args:
            sock: A connected socket.socket.
            frame: The complete frame bytes (header + payload).
            timeout: Per-send timeout in seconds.
        """
        sock.settimeout(timeout)
        total_sent = 0
        while total_sent < len(frame):
            sent = sock.send(frame[total_sent:])
            if sent == 0:
                raise ConnectionError("Peer closed connection while sending")
            total_sent += sent
