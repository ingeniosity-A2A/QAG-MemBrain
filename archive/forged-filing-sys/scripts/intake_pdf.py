#!/usr/bin/env python3
"""
Minimal PDF Intake Script — Forged-AI-Filing-OS
PDF → Infinity-Parser / Docling → Embed → turbovec.IdMapIndex
"""

from __future__ import annotations
import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

# Optional heavy deps – import lazily or replace with your actual stack
try:
    from docling.document_converter import DocumentConverter
except ImportError:
    DocumentConverter = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

try:
    import turbovec
except ImportError:
    turbovec = None


def embed_text(texts: list[str], model_name: str = "nomic-ai/nomic-embed-text-v1.5") -> np.ndarray:
    if SentenceTransformer is None:
        raise RuntimeError("sentence-transformers not installed")
    model = SentenceTransformer(model_name, trust_remote_code=True)
    return model.encode(texts, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)


def parse_pdf(path: Path) -> dict[str, Any]:
    """Return a minimal DocLang-like structure.
    Replace the body with real Infinity-Parser or Docling call.
    """
    if DocumentConverter is None:
        # Fallback stub for demo
        return {
            "source": str(path),
            "pages": [{"page": 1, "text": f"[stub] content of {path.name}"}],
            "tables": [],
            "metadata": {"parser": "stub"},
        }

    converter = DocumentConverter()
    result = converter.convert(str(path))
    # Convert to a simple dict; real code would emit full DocLang JSON
    return {
        "source": str(path),
        "markdown": result.document.export_to_markdown(),
        "metadata": {"parser": "docling"},
    }


def ingest_pdf(
    pdf_path: Path,
    index_path: Path,
    dim: int = 768,
    bits: int = 4,
) -> int:
    parsed = parse_pdf(pdf_path)

    # Flatten text for embedding (real system would chunk by layout)
    texts = []
    if "markdown" in parsed:
        texts.append(parsed["markdown"])
    elif "pages" in parsed:
        texts.extend(p.get("text", "") for p in parsed["pages"])

    if not texts:
        raise ValueError("No text extracted from PDF")

    vectors = embed_text(texts)

    if turbovec is None:
        print("[demo] turbovec not installed – vectors computed but not indexed")
        return len(texts)

    # Create or load IdMapIndex
    if index_path.exists():
        index = turbovec.IdMapIndex.load(str(index_path))
    else:
        index = turbovec.IdMapIndex(dim=dim, bit_width=bits)

    # Assign stable IDs (simple sequential for demo)
    start_id = getattr(index, "size", 0) or 0
    ids = np.arange(start_id, start_id + len(texts), dtype=np.uint64)

    index.add_with_ids(vectors, ids)
    index.sync(str(index_path))

    # Side-car metadata (real system would store richer DocLang + spatial coords)
    meta_path = index_path.with_suffix(".meta.json")
    meta = {}
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
    for i, tid in enumerate(ids):
        meta[str(tid)] = {
            "source": str(pdf_path),
            "chunk": i,
            "parser": parsed.get("metadata", {}).get("parser", "unknown"),
            "domain": "document",
            "training_ready": True,
        }
    meta_path.write_text(json.dumps(meta, indent=2))

    print(f"Ingested {len(texts)} chunks from {pdf_path.name} → {index_path}")
    return len(texts)


def main():
    parser = argparse.ArgumentParser(description="PDF → turbovec intake")
    parser.add_argument("pdf", type=Path, help="Path to PDF file")
    parser.add_argument("--index", type=Path, default=Path("repo/vector_index/repo.tvim"))
    parser.add_argument("--dim", type=int, default=768)
    parser.add_argument("--bits", type=int, default=4)
    args = parser.parse_args()

    ingest_pdf(args.pdf, args.index, dim=args.dim, bits=args.bits)


if __name__ == "__main__":
    main()
