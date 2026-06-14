"""
Graph-to-mesh serialization for the QAG-MemBrain fast_mesh layer.

Binary wire format
------------------

The serialized blob (before optional compression) has the following layout::

    +--------+--------+-------------+-------------+
    | magic  | version| node_count  | edge_count  |
    | 4B     | 2B     | 4B          | 4B          |
    +--------+--------+-------------+-------------+
    | node entries ...                            |
    +---------------------------------------------+
    | edge entries ...                            |
    +---------------------------------------------+

**Header** (14 bytes):
- ``magic``: 4 bytes — ``b"QMG1"``
- ``version``: uint16 little-endian — format version (currently 1)
- ``node_count``: uint32 little-endian
- ``edge_count``: uint32 little-endian

**Node entry** (each):
- ``length``: uint32 little-endian — byte length of the JSON payload
- ``payload``: *length* bytes — UTF-8 encoded JSON with keys
  ``id``, ``label``, ``properties``

**Edge entry** (each):
- ``length``: uint32 little-endian — byte length of the JSON payload
- ``payload``: *length* bytes — UTF-8 encoded JSON with keys
  ``id``, ``source``, ``target``, ``type``, ``properties``

The entire blob is then compressed with ``zlib.compress`` and a 1-byte
compression flag is prepended (``0x01`` = compressed, ``0x00`` = raw).
"""

import io
import json
import struct
import zlib
from typing import Dict, List, Tuple

# Header constants
MAGIC = b"QMG1"
VERSION = 1
HEADER_FMT = "<4sHII"  # magic(4) + version(uint16) + node_count(uint32) + edge_count(uint32)
HEADER_SIZE = struct.calcsize(HEADER_FMT)  # 14 bytes

# Entry length prefix
LEN_FMT = "<I"
LEN_SIZE = struct.calcsize(LEN_FMT)  # 4 bytes

# Compression flag
COMPRESSED = 0x01
RAW = 0x00


class GraphMeshSerializer:
    """
    Serialize / deserialize graph data (nodes + edges) to a compact binary
    format suitable for storage in the mesh.
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def serialize_graph(self, nodes: List[dict], edges: List[dict]) -> bytes:
        """
        Serialize a graph to a compressed binary blob.

        Parameters
        ----------
        nodes:
            List of dicts, each with keys ``id``, ``label``, ``properties``.
        edges:
            List of dicts, each with keys ``id``, ``source``, ``target``,
            ``type``, ``properties``.

        Returns
        -------
        bytes
            Compressed binary representation.
        """
        raw = self._serialize_raw(nodes, edges)
        compressed = zlib.compress(raw, level=6)
        # Prepend compression flag
        return bytes([COMPRESSED]) + compressed

    def deserialize_graph(self, data: bytes) -> Tuple[List[dict], List[dict]]:
        """
        Deserialize a binary blob back into (nodes, edges).

        Parameters
        ----------
        data:
            Binary blob as produced by ``serialize_graph``.

        Returns
        -------
        Tuple[List[dict], List[dict]]
            (nodes, edges)
        """
        if not data or len(data) < 2:
            raise ValueError("Data too short to be a valid graph blob")

        flag = data[0]
        payload = data[1:]

        if flag == COMPRESSED:
            raw = zlib.decompress(payload)
        elif flag == RAW:
            raw = payload
        else:
            raise ValueError(f"Unknown compression flag: 0x{flag:02x}")

        return self._deserialize_raw(raw)

    def serialize_node(self, node: dict) -> bytes:
        """
        Serialize a single node to a length-prefixed JSON blob (no header,
        no compression).
        """
        payload = json.dumps(node, separators=(",", ":"), ensure_ascii=False, sort_keys=True).encode("utf-8")
        return struct.pack(LEN_FMT, len(payload)) + payload

    def deserialize_node(self, data: bytes) -> dict:
        """
        Deserialize a single node from a length-prefixed JSON blob.
        """
        if len(data) < LEN_SIZE:
            raise ValueError("Data too short for node entry")
        length = struct.unpack(LEN_FMT, data[:LEN_SIZE])[0]
        payload = data[LEN_SIZE : LEN_SIZE + length]
        return json.loads(payload.decode("utf-8"))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _serialize_raw(self, nodes: List[dict], edges: List[dict]) -> bytes:
        """Build the uncompressed binary blob (header + entries)."""
        buf = io.BytesIO()

        # Header
        buf.write(struct.pack(HEADER_FMT, MAGIC, VERSION, len(nodes), len(edges)))

        # Node entries
        for node in nodes:
            self._write_entry(buf, node)

        # Edge entries
        for edge in edges:
            self._write_entry(buf, edge)

        return buf.getvalue()

    def _deserialize_raw(self, raw: bytes) -> Tuple[List[dict], List[dict]]:
        """Parse the uncompressed binary blob."""
        if len(raw) < HEADER_SIZE:
            raise ValueError(f"Raw data too short for header: {len(raw)} bytes")

        magic, version, node_count, edge_count = struct.unpack(
            HEADER_FMT, raw[:HEADER_SIZE]
        )

        if magic != MAGIC:
            raise ValueError(f"Invalid magic bytes: {magic!r}")
        if version != VERSION:
            raise ValueError(f"Unsupported version: {version}")

        offset = HEADER_SIZE
        nodes: List[dict] = []
        edges: List[dict] = []

        # Read nodes
        for _ in range(node_count):
            entry, offset = self._read_entry(raw, offset)
            nodes.append(entry)

        # Read edges
        for _ in range(edge_count):
            entry, offset = self._read_entry(raw, offset)
            edges.append(entry)

        return nodes, edges

    @staticmethod
    def _write_entry(buf: io.BytesIO, obj: dict) -> None:
        """Write a length-prefixed JSON entry into *buf*."""
        payload = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=True).encode("utf-8")
        buf.write(struct.pack(LEN_FMT, len(payload)))
        buf.write(payload)

    @staticmethod
    def _read_entry(data: bytes, offset: int) -> Tuple[dict, int]:
        """Read a single length-prefixed JSON entry starting at *offset*."""
        if offset + LEN_SIZE > len(data):
            raise ValueError(f"Unexpected end of data at offset {offset}")
        length = struct.unpack(LEN_FMT, data[offset : offset + LEN_SIZE])[0]
        offset += LEN_SIZE
        if offset + length > len(data):
            raise ValueError(
                f"Entry payload extends beyond data: need {length} bytes at offset {offset}, have {len(data) - offset}"
            )
        payload = data[offset : offset + length]
        obj = json.loads(payload.decode("utf-8"))
        return obj, offset + length
