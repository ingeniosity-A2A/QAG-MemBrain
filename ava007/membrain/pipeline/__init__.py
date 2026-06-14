"""
QAG-MemBrain Pipeline Layer (Layer 7: PIPELINE ORCHESTRATION)
==============================================================

Orchestrates the end-to-end query flow through all MemBrain layers:
from query ingestion through routing, retrieval, augmentation,
writeback, and response generation.

Quick start::

    from ava007.membrain.pipeline import MembrainPipeline

    pipeline = MembrainPipeline()
    result = pipeline.execute("What is the deployment status of cluster-7?")
    print(result.answer, result.mode, result.confidence)

Exports
-------
MembrainPipeline      — Core pipeline wiring all layers together
QueryOrchestrator     — End-to-end query flow with stage tracking
MemoryWriteback       — Memory → ion store writeback with verification
ResponseGenerator     — Structured response generation with citations
PipelineResult        — Single query execution result
PipelineStats         — Aggregate pipeline statistics
OrchestrationResult   — Orchestrated query execution result
StageResult           — Single stage execution result
WritebackRecord       — Writeback operation record
GeneratedResponse     — Structured response with citations
Citation              — Source citation reference
"""

from .pipeline import MembrainPipeline, PipelineResult, PipelineStats
from .orchestration import (
    QueryOrchestrator,
    OrchestrationResult,
    StageResult,
    StageStatus,
    DEFAULT_STAGES,
)
from .writeback import (
    MemoryWriteback,
    WritebackRecord,
    compute_result_hash,
    select_tier,
)
from .response_generator import (
    ResponseGenerator,
    GeneratedResponse,
    Citation,
)

__all__ = [
    # Core pipeline
    "MembrainPipeline",
    "PipelineResult",
    "PipelineStats",
    # Orchestration
    "QueryOrchestrator",
    "OrchestrationResult",
    "StageResult",
    "StageStatus",
    "DEFAULT_STAGES",
    # Writeback
    "MemoryWriteback",
    "WritebackRecord",
    "compute_result_hash",
    "select_tier",
    # Response generation
    "ResponseGenerator",
    "GeneratedResponse",
    "Citation",
]
