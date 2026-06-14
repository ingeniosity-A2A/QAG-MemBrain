"""
hf_inference.py — HuggingFace CLI & Inference Adapter
======================================================
Provides a unified interface to HuggingFace inference that can be
used across all Griptape workflow nodes and the AVA-007 runtime.

Four inference modes:
  1. hub:       HuggingFaceHubPromptDriver — GPU-LESS, cloud API, zero local VRAM
  2. local:     HuggingFacePipelinePromptDriver — on-device, zero API cost
  3. inference:  OpenAiChatPromptDriver -> HF Inference API (OpenAI-compatible)
  4. tgi:       OpenAiChatPromptDriver -> self-hosted TGI endpoint

GPU-less architecture (hub mode):
  - HuggingFaceHubPromptDriver: remote text generation via HF Inference API
  - HuggingFaceHubEmbeddingDriver: remote vectorization, no local GPU needed
  - LocalVectorStoreDriver: vector indices stored locally, embeddings computed remotely
  - Zero local footprint — runs on handsets, Termux, edge nodes without GPU

Also provides CLI wrappers for:
  - Model downloading and caching (hf download)
  - Model listing and discovery (hf ls)
  - Token and auth management (hf whoami)

This module ensures that NO OpenRouter calls exist anywhere in the stack.
HuggingFace is the sole inference provider from embedding to generation.
"""

from __future__ import annotations

import os
import json
import subprocess
import shutil
from dataclasses import dataclass, field
from typing import Any, Optional


# =========================================================================
# 1. HF CLI WRAPPER
#    Wraps the `hf` CLI for model management operations.
# =========================================================================

@dataclass
class HFModelInfo:
    """Information about a cached or available HuggingFace model."""
    model_id: str
    revision: str = "main"
    size_on_disk: str = "unknown"
    is_cached: bool = False
    pipeline_tag: str = ""  # text-generation, sentence-similarity, etc.


class HFCliAdapter:
    """
    Wraps the HuggingFace `hf` CLI for model management.

    The `hf` CLI is optimized for both humans and coding agents.
    It dramatically reduces token usage (up to 6x on complex tasks)
    compared to raw SDK or curl.

    Installation:
      curl -LsSf https://hf.co/cli/install.sh | bash
      hf auth login

    See: docs/guides/using-hf-cli-with-goose.md
    """

    def __init__(self, hf_token: str | None = None):
        self.hf_token = hf_token or os.environ.get("HF_TOKEN", "")
        self._hf_cli = shutil.which("hf")

    @property
    def cli_available(self) -> bool:
        """Check if the `hf` CLI is installed and accessible."""
        return self._hf_cli is not None

    def download_model(
        self,
        model_id: str,
        revision: str = "main",
        cache_dir: str | None = None,
    ) -> dict:
        """
        Download a model from HuggingFace Hub using `hf download`.

        Returns: { "status": "success"|"error", "model_id": str, "output": str }
        """
        if not self.cli_available:
            return {
                "status": "error",
                "model_id": model_id,
                "output": "hf CLI not found. Install: curl -LsSf https://hf.co/cli/install.sh | bash",
            }

        cmd = ["hf", "download", model_id, "--revision", revision]
        if cache_dir:
            cmd.extend(["--cache-dir", cache_dir])

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300
            )
            return {
                "status": "success" if result.returncode == 0 else "error",
                "model_id": model_id,
                "output": result.stdout.strip() or result.stderr.strip(),
            }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "model_id": model_id,
                "output": "Download timed out after 300s",
            }
        except Exception as e:
            return {
                "status": "error",
                "model_id": model_id,
                "output": str(e),
            }

    def list_cached_models(self, cache_dir: str | None = None) -> list[HFModelInfo]:
        """
        List models cached locally using `hf ls`.

        Returns a list of HFModelInfo for each cached model.
        """
        if not self.cli_available:
            return []

        cmd = ["hf", "ls"]
        if cache_dir:
            cmd.extend(["--cache-dir", cache_dir])

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                return []

            models = []
            for line in result.stdout.strip().split("\n"):
                if not line.strip():
                    continue
                # Parse TSV output from hf ls
                parts = line.split("\t")
                if len(parts) >= 1:
                    models.append(HFModelInfo(
                        model_id=parts[0].strip(),
                        is_cached=True,
                        pipeline_tag=parts[1].strip() if len(parts) > 1 else "",
                    ))
            return models
        except Exception:
            return []

    def check_auth(self) -> dict:
        """
        Check HuggingFace authentication status using `hf whoami`.

        Returns: { "authenticated": bool, "username": str, "output": str }
        """
        if not self.cli_available:
            return {
                "authenticated": False,
                "username": "",
                "output": "hf CLI not found",
            }

        try:
            env = os.environ.copy()
            if self.hf_token:
                env["HF_TOKEN"] = self.hf_token

            result = subprocess.run(
                ["hf", "whoami"], capture_output=True, text=True,
                timeout=10, env=env,
            )
            if result.returncode == 0:
                return {
                    "authenticated": True,
                    "username": result.stdout.strip(),
                    "output": result.stdout.strip(),
                }
            return {
                "authenticated": False,
                "username": "",
                "output": result.stderr.strip() or "Not authenticated",
            }
        except Exception as e:
            return {
                "authenticated": False,
                "username": "",
                "output": str(e),
            }


# =========================================================================
# 2. UNIFIED INFERENCE FACTORY
#    Creates the appropriate Griptape driver based on deployment mode.
# =========================================================================

def create_prompt_driver(
    mode: str = "hub",
    model: str = "mistralai/Mistral-7B-Instruct-v0.2",
    device: str = "cpu",
    max_tokens: int = 1024,
    temperature: float = 0.7,
    hf_endpoint_url: str | None = None,
    hf_token: str | None = None,
):
    """
    Create a HuggingFace-backed prompt driver.

    This is the SINGLE factory for all prompt drivers in the AVA-007 stack.
    No OpenRouter. No external paid APIs (unless using HF Inference API mode).

    Modes:
      - "hub": HuggingFaceHubPromptDriver — GPU-LESS cloud inference.
        Uses HF Inference API via Griptape's native Hub driver.
        Zero local VRAM. Zero local compute. Requires HF_TOKEN.
        Best for: production, edge devices, Termux, S25 Ultra, any GPU-less deployment.
        THIS IS THE DEFAULT AND RECOMMENDED MODE.

      - "local": HuggingFacePipelinePromptDriver — model runs on-device.
        Zero API cost. Requires transformers + torch installed.
        Best for: air-gapped environments, development with local GPU.

      - "inference": OpenAiChatPromptDriver -> HF Inference API.
        Uses OpenAI-compatible endpoint at api-inference.huggingface.co.
        Same cloud as "hub" but via OpenAI-compatible protocol.
        Best for: compatibility with OpenAI tooling, streaming support.

      - "tgi": OpenAiChatPromptDriver -> self-hosted TGI endpoint.
        Full control, no per-token cost, requires GPU server.
        Best for: production with dedicated GPU infrastructure.
    """
    token = hf_token or os.environ.get("HF_TOKEN", "")

    if mode == "hub":
        from griptape.drivers.prompt.huggingface_hub import HuggingFaceHubPromptDriver
        return HuggingFaceHubPromptDriver(
            model=model,
            api_token=token,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    elif mode == "local":
        from griptape.drivers.prompt.huggingface_pipeline import HuggingFacePipelinePromptDriver
        return HuggingFacePipelinePromptDriver(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    elif mode == "inference":
        from griptape.drivers.prompt.openai import OpenAiChatPromptDriver
        return OpenAiChatPromptDriver(
            base_url="https://api-inference.huggingface.co/v1",
            api_key=token,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    elif mode == "tgi":
        from griptape.drivers.prompt.openai import OpenAiChatPromptDriver
        if not hf_endpoint_url:
            raise ValueError(
                "TGI mode requires hf_endpoint_url parameter. "
                "Example: http://your-gpu-server:8080/v1"
            )
        return OpenAiChatPromptDriver(
            base_url=hf_endpoint_url,
            api_key=token,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    else:
        raise ValueError(
            f"Unknown inference mode: {mode}. "
            "Use 'hub', 'local', 'inference', or 'tgi'."
        )


def create_embedding_driver(
    model: str = "sentence-transformers/all-MiniLM-L6-v2",
    hf_token: str | None = None,
):
    """
    Create a HuggingFace embedding driver.

    Uses HuggingFace Hub for embedding inference.
    Requires HF_TOKEN for authenticated access (free tier available).

    GPU-less: embeddings computed on HF's remote infrastructure.
    No OpenAI embeddings. HuggingFace is the sole embedding provider.
    """
    from griptape.drivers.embedding.huggingface_hub import HuggingFaceHubEmbeddingDriver

    return HuggingFaceHubEmbeddingDriver(
        model=model,
        api_token=hf_token or os.environ.get("HF_TOKEN", "hf_free_tier"),
    )


def create_vector_store_driver(
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2",
    hf_token: str | None = None,
):
    """
    Create a LocalVectorStoreDriver with HF Hub embeddings.

    The vector store lives locally (zero cloud storage dependency),
    but embeddings are computed remotely via HuggingFaceHubEmbeddingDriver.
    This is the GPU-less Cavern retrieval path.
    """
    from griptape.drivers.vector.local import LocalVectorStoreDriver

    embedding_driver = create_embedding_driver(model=embedding_model, hf_token=hf_token)
    return LocalVectorStoreDriver(embedding_driver=embedding_driver)


# =========================================================================
# 3. MODEL REGISTRY
#    Pre-configured model configurations for the AVA-007 stack.
# =========================================================================

@dataclass(frozen=True)
class ModelConfig:
    """Pre-configured model for a specific role in the AVA-007 stack."""
    role: str               # "coordination", "embedding", "synthesis"
    model_id: str           # HuggingFace model identifier
    mode: str               # "hub", "local", "inference", "tgi"
    device: str             # "cpu", "cuda", "mps" (only relevant for "local")
    max_tokens: int
    temperature: float


# Recommended configurations for the AVA-007 coordination layer
# Default mode is "hub" (GPU-less) for all roles
MODEL_REGISTRY: dict[str, ModelConfig] = {
    # Primary coordination agent — L6 decision authority
    "ava007_coordination": ModelConfig(
        role="coordination",
        model_id="mistralai/Mistral-7B-Instruct-v0.2",
        mode="hub",
        device="cpu",
        max_tokens=1024,
        temperature=0.7,
    ),
    # A2A query transform — structured JSON output, low temperature
    "ava007_query_transform": ModelConfig(
        role="coordination",
        model_id="mistralai/Mistral-7B-Instruct-v0.2",
        mode="hub",
        device="cpu",
        max_tokens=256,
        temperature=0.3,
    ),
    # Rev.Ike synthesis — psychological container, moderate temperature
    "revike_synthesis": ModelConfig(
        role="synthesis",
        model_id="mistralai/Mistral-7B-Instruct-v0.2",
        mode="hub",
        device="cpu",
        max_tokens=512,
        temperature=0.5,
    ),
    # Embedding — sentence similarity for GraphRAG retrieval
    "embedding_retrieval": ModelConfig(
        role="embedding",
        model_id="sentence-transformers/all-MiniLM-L6-v2",
        mode="hub",  # GPU-less embeddings via HF Hub API
        device="cpu",
        max_tokens=0,
        temperature=0.0,
    ),
    # GRPO training judge — LLM-as-judge for memory management scoring
    "grpo_judge": ModelConfig(
        role="coordination",
        model_id="mistralai/Mistral-7B-Instruct-v0.2",
        mode="hub",
        device="cpu",
        max_tokens=256,
        temperature=0.2,
    ),
    # Local fallback — on-device inference for air-gapped environments
    "ava007_coordination_local": ModelConfig(
        role="coordination",
        model_id="google/gemma-2-9b-it",
        mode="local",
        device="cpu",
        max_tokens=1024,
        temperature=0.7,
    ),
}


def get_model_config(role: str) -> ModelConfig | None:
    """Get a pre-configured ModelConfig by registry key."""
    return MODEL_REGISTRY.get(role)


def create_driver_from_config(config: ModelConfig):
    """Create a prompt or embedding driver from a ModelConfig."""
    if config.role == "embedding":
        return create_embedding_driver(model=config.model_id)
    return create_prompt_driver(
        mode=config.mode,
        model=config.model_id,
        device=config.device,
        max_tokens=config.max_tokens,
        temperature=config.temperature,
    )


# =========================================================================
# 4. HEALTH CHECK
#    Verify the HuggingFace inference stack is operational.
# =========================================================================

def health_check() -> dict:
    """
    Run a comprehensive health check on the HuggingFace inference stack.

    Returns: {
        "status": "healthy"|"degraded"|"unhealthy",
        "checks": { ... },
        "recommendations": [ str ]
    }
    """
    checks = {}
    recommendations = []

    # Check 1: HF CLI availability
    cli = HFCliAdapter()
    checks["hf_cli_available"] = cli.cli_available
    if not cli.cli_available:
        recommendations.append(
            "Install the hf CLI: curl -LsSf https://hf.co/cli/install.sh | bash"
        )

    # Check 2: HF authentication
    auth = cli.check_auth()
    checks["hf_authenticated"] = auth["authenticated"]
    if not auth["authenticated"]:
        recommendations.append(
            "Authenticate with HF: hf auth login"
        )

    # Check 3: HF_TOKEN environment variable
    has_token = bool(os.environ.get("HF_TOKEN"))
    checks["hf_token_set"] = has_token
    if not has_token:
        recommendations.append(
            "Set HF_TOKEN environment variable for Hub driver inference"
        )

    # Check 4: Griptape Hub driver imports (GPU-less path)
    try:
        from griptape.drivers.prompt.huggingface_hub import HuggingFaceHubPromptDriver
        from griptape.drivers.embedding.huggingface_hub import HuggingFaceHubEmbeddingDriver
        checks["griptape_hub_drivers"] = True
    except ImportError as e:
        checks["griptape_hub_drivers"] = False
        recommendations.append(f"Griptape Hub driver import failed: {e}")

    # Check 5: Griptape Pipeline driver imports (local GPU path)
    try:
        from griptape.drivers.prompt.huggingface_pipeline import HuggingFacePipelinePromptDriver
        checks["griptape_pipeline_driver"] = True
    except ImportError as e:
        checks["griptape_pipeline_driver"] = False
        recommendations.append(f"Griptape Pipeline driver import failed: {e}")

    # Check 6: LocalVectorStoreDriver
    try:
        from griptape.drivers.vector.local import LocalVectorStoreDriver
        checks["local_vector_store_driver"] = True
    except ImportError as e:
        checks["local_vector_store_driver"] = False
        recommendations.append(f"LocalVectorStoreDriver import failed: {e}")

    # Check 7: transformers library (for local pipeline — optional)
    try:
        import transformers
        checks["transformers_available"] = True
        checks["transformers_version"] = transformers.__version__
    except ImportError:
        checks["transformers_available"] = False
        # Not critical — Hub mode doesn't need transformers
        recommendations.append(
            "Optional: install transformers for local inference: pip install transformers torch"
        )

    # Check 8: torch library (optional — for local GPU path only)
    try:
        import torch
        checks["torch_available"] = True
        checks["torch_cuda_available"] = torch.cuda.is_available()
        if torch.cuda.is_available():
            checks["torch_cuda_device"] = torch.cuda.get_device_name(0)
    except ImportError:
        checks["torch_available"] = False
        # Not critical — Hub mode doesn't need torch

    # Check 9: sentence-transformers (optional — for local embeddings)
    try:
        import sentence_transformers
        checks["sentence_transformers_available"] = True
    except ImportError:
        checks["sentence_transformers_available"] = False
        # Not critical — Hub mode computes embeddings remotely

    # Check 10: No OpenRouter references in environment
    has_openrouter = bool(os.environ.get("OPENROUTER_API_KEY"))
    checks["no_openrouter_keys"] = not has_openrouter
    if has_openrouter:
        recommendations.append(
            "OPENROUTER_API_KEY is set but will NOT be used. "
            "HuggingFace is the sole inference provider. "
            "You may remove this variable."
        )

    # Overall status — Hub drivers are critical, everything else is optional
    critical_ok = checks.get("griptape_hub_drivers", False) and has_token
    degraded = not all([
        checks.get("hf_cli_available", False),
        checks.get("hf_authenticated", False),
    ])

    if critical_ok and not degraded:
        status = "healthy"
    elif critical_ok:
        status = "degraded"
    else:
        status = "unhealthy"

    return {
        "status": status,
        "checks": checks,
        "recommendations": recommendations,
    }


# =========================================================================
# CLI ENTRY POINT
# =========================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="HuggingFace Inference Adapter for AVA-007"
    )
    parser.add_argument(
        "command",
        choices=["health", "download", "list", "auth"],
        help="Command to run",
    )
    parser.add_argument(
        "--model",
        default="mistralai/Mistral-7B-Instruct-v0.2",
        help="Model ID for download command",
    )

    args = parser.parse_args()

    if args.command == "health":
        result = health_check()
        print(f"\nHF Inference Stack Status: {result['status'].upper()}\n")
        for check, value in result["checks"].items():
            icon = "OK" if value else "MISSING"
            print(f"  [{icon}] {check}: {value}")
        if result["recommendations"]:
            print("\nRecommendations:")
            for rec in result["recommendations"]:
                print(f"  - {rec}")

    elif args.command == "download":
        cli = HFCliAdapter()
        result = cli.download_model(args.model)
        print(f"Download {result['status']}: {result['output']}")

    elif args.command == "list":
        cli = HFCliAdapter()
        models = cli.list_cached_models()
        if models:
            print("\nCached HuggingFace Models:")
            for m in models:
                print(f"  {m.model_id} (tag: {m.pipeline_tag})")
        else:
            print("No cached models found.")

    elif args.command == "auth":
        cli = HFCliAdapter()
        result = cli.check_auth()
        if result["authenticated"]:
            print(f"Authenticated as: {result['username']}")
        else:
            print(f"Not authenticated: {result['output']}")
