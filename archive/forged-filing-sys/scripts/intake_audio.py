#!/usr/bin/env python3
"""
Minimal Audio Intake Script — Forged-AI-Filing-OS
Audio → Whisper LoRA (council) → Embed → turbovec.IdMapIndex
"""

from __future__ import annotations
import argparse
import json
from pathlib import Path

import numpy as np

try:
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    from peft import PeftModel
except ImportError:
    WhisperForConditionalGeneration = WhisperProcessor = PeftModel = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

try:
    import turbovec
except ImportError:
    turbovec = None


def load_whisper_lora(
    base: str = "openai/whisper-large-v3",
    adapter: str = "opencouncil/whisper-large-v3-el-council-lora",
):
    if WhisperForConditionalGeneration is None:
        raise RuntimeError("transformers / peft not installed")
    model = WhisperForConditionalGeneration.from_pretrained(base)
    model = PeftModel.from_pretrained(model, adapter)
    model = model.merge_and_unload()
    processor = WhisperProcessor.from_pretrained(base, language="greek", task="transcribe")
    return model, processor


def transcribe(audio_path: Path, model, processor) -> str:
    # Real implementation would use faster-whisper or the official generate path
    # This is a structural stub
    import torch
    import librosa

    speech, sr = librosa.load(str(audio_path), sr=16000)
    inputs = processor(speech, sampling_rate=16000, return_tensors="pt")
    with torch.no_grad():
        generated = model.generate(**inputs)
    return processor.batch_decode(generated, skip_special_tokens=True)[0]


def embed_text(texts: list[str], model_name: str = "nomic-ai/nomic-embed-text-v1.5") -> np.ndarray:
    if SentenceTransformer is None:
        raise RuntimeError("sentence-transformers not installed")
    model = SentenceTransformer(model_name, trust_remote_code=True)
    return model.encode(texts, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)


def ingest_audio(
    audio_path: Path,
    index_path: Path,
    dim: int = 768,
    bits: int = 4,
) -> int:
    model, processor = load_whisper_lora()
    transcript = transcribe(audio_path, model, processor)

    # Simple chunking (real system would use speaker turns / time windows)
    chunks = [c.strip() for c in transcript.split(".") if c.strip()]
    if not chunks:
        chunks = [transcript]

    vectors = embed_text(chunks)

    if turbovec is None:
        print("[demo] turbovec not installed – transcript ready but not indexed")
        print(transcript[:500])
        return len(chunks)

    if index_path.exists():
        index = turbovec.IdMapIndex.load(str(index_path))
    else:
        index = turbovec.IdMapIndex(dim=dim, bit_width=bits)

    start_id = getattr(index, "size", 0) or 0
    ids = np.arange(start_id, start_id + len(chunks), dtype=np.uint64)
    index.add_with_ids(vectors, ids)
    index.sync(str(index_path))

    meta_path = index_path.with_suffix(".meta.json")
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    for i, tid in enumerate(ids):
        meta[str(tid)] = {
            "source": str(audio_path),
            "chunk": i,
            "transcript": chunks[i],
            "parser": "whisper-large-v3-el-council-lora",
            "domain": "municipal_council",
            "training_ready": True,
        }
    meta_path.write_text(json.dumps(meta, indent=2))

    print(f"Ingested {len(chunks)} transcript chunks from {audio_path.name}")
    return len(chunks)


def main():
    parser = argparse.ArgumentParser(description="Audio → Whisper → turbovec intake")
    parser.add_argument("audio", type=Path, help="Path to audio file")
    parser.add_argument("--index", type=Path, default=Path("repo/vector_index/repo.tvim"))
    parser.add_argument("--dim", type=int, default=768)
    parser.add_argument("--bits", type=int, default=4)
    args = parser.parse_args()

    ingest_audio(args.audio, args.index, dim=args.dim, bits=args.bits)


if __name__ == "__main__":
    main()
