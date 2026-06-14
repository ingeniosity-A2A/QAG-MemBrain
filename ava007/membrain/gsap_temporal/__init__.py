"""
QAG-MemBrain GSAP Temporal Synchronization Layer (LAYER 5)
Ava007 Cognitive Runtime

Bridges GSAP (GreenSock Animation Platform) with cognitive temporal memory.
Provides deterministic lifecycle management, superposition observation/collapse,
and cognitive epoch visualization.

Modules:
    gsap_temporal.js   — Core GSAP-compatible timeline engine (Node.js/browser)
    visualization      — Cognitive epoch ASCII/Unicode visualization (Python)
"""

from __future__ import annotations

from ava007.membrain.gsap_temporal.visualization import (
    CognitiveEpochVisualizer,
    render_epoch_detail,
    render_heatmap,
    render_state_transition,
    render_superposition_tree,
    render_timeline,
)

__all__ = [
    "CognitiveEpochVisualizer",
    "render_timeline",
    "render_superposition_tree",
    "render_epoch_detail",
    "render_heatmap",
    "render_state_transition",
]

__version__ = "1.0.0"
__layer__ = "L5_GSAP_TEMPORAL"
