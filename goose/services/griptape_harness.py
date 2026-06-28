"""
QAG_MemBrain — Griptape Harness
================================
Wraps the A2A handshake between Ava-007 (Station Chief) and the
Rev.Ike subconscious runtime as a deterministic Griptape Workflow DAG.

Also implements the AtomMem CRUD action space as Griptape Tools:
  @activity: create_memory, read_memory, update_memory, delete_memory

The harness provides:
  - Deterministic workflow execution (not conversational)
  - off_prompt TaskMemory isolation (large context stays out of LLM window)
  - Structured output validation (XML tags → scored for GRPO training)
  - 10x faster orchestration vs natural language prompt routing

GRPO training loop:
  - Agent emits XML CRUD tags alongside decisions
  - Harness scores via EM match or LLM-as-judge
  - Rewards feed back to update the routing policy
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional
from datetime import datetime

# ---------------------------------------------------------------------------
# Minimal stubs so the file is importable without Griptape installed.
# Replace with: from griptape.tasks import ToolkitTask, PromptTask
#               from griptape.workflows import Workflow
#               from griptape.memory.task import TaskMemory
#               from griptape.tools import BaseTool
#               from griptape.utils import ActivitySchema
# ---------------------------------------------------------------------------
try:
    from griptape.tasks import ToolkitTask, PromptTask
    from griptape.workflows import Workflow
    from griptape.memory.task import TaskMemory
    from griptape.tools import BaseTool
    from griptape.decorators import activity
    from griptape.artifacts import TextArtifact
    _GRIPTAPE_AVAILABLE = True
except ImportError:
    _GRIPTAPE_AVAILABLE = False
    # Lightweight stubs for development without Griptape installed
    class BaseTool: pass  # type: ignore
    def activity(schema=None, config=None):  # type: ignore
        def decorator(fn): return fn
        return decorator
    class TextArtifact(str): pass  # type: ignore


# ─── A2A Payload (structured JSON — strict, no fluff) ──────────────────────
@dataclass
class A2AHandshakePayload:
    """
    Ava-007 → Rev.Ike payload.
    Strictly structured. Not conversational.
    Trigger: Strategic Ambiguity or Motivational Requirement only.
    """
    operation_context:  str          # Tactical situation description
    current_mood_flag:  str          # "high_stress" | "neutral" | "motivated"
    philosophical_query: str         # Pre-abstracted by Ava-007 (no physical nouns)
    target_themes:      list[str]    # ["Overcoming_Obstacles", "Commanding_Reality"]
    atom_id:            str          # Source atom triggering the handshake
    session_id:         str
    timestamp:          str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class A2ARevelationResponse:
    """
    Rev.Ike → Ava-007 response.
    Always JSON. No prose. Actionable intelligence only.
    """
    philosophical_diagnosis: str   # Root cause in "Science of Living" terms
    strategic_advice:        str   # High-level direction
    tactical_directive:      str   # Specific executable action
    confidence:              float
    source_chunks:           list[str]  # Off-prompt keys (not raw tokens)
    audio_asset_url:         Optional[str] = None  # Optional Cavern spatial audio


# ─── AtomMem CRUD Tool (Griptape @activity methods) ───────────────────────
class AtomMemTool(BaseTool):
    """
    Griptape Tool implementing the AtomMem CRUD action space.

    Model is granted these XML-token activities:
      <create_memory>  — persist a novel insight to JSONL + Neo4j
      <read_memory>    — retrieve a specific atom by id
      <update_memory>  — supersede an outdated atom (append-only: writes tombstone + new)
      <delete_memory>  — tombstone a redundant atom (JSONL never mutates)

    Trained via GRPO:
      - Structured output driver ensures valid XML on every call
      - EM match scorer: correct tag → +1 reward
      - LLM-as-judge scorer: quality of rationale → 0-1 reward
      - Policy learns when to prune redundant atoms autonomously
    """
    name: str = "AtomMemTool"

    # Injected dependencies — set after construction
    jsonl_path:  str = "./memory.jsonl"
    audit_path:  str = "./audit.jsonl"
    neo4j_write: Any = None   # Callable: (atom_dict) → None

    @activity(config={"description": "Create and persist a new atomic memory record."})
    def create_memory(self, params: dict) -> TextArtifact:
        atom = {
            "id":        str(uuid.uuid4()),
            "type":      params.get("type", "memory"),
            "source":    "atom_mem",
            "timestamp": int(datetime.utcnow().timestamp() * 1000),
            "title":     params.get("title", "AtomMem creation"),
            "content":   params.get("content", ""),
            "tags":      params.get("tags", ["atom_mem"]),
            "embedding": None,
            "metadata": {
                "confidence": params.get("confidence", 0.9),
                "importance": params.get("importance", "medium"),
                "atom_mem_action": "create",
            },
        }
        self._append_jsonl(atom)
        if self.neo4j_write:
            self.neo4j_write(atom)
        return TextArtifact(json.dumps({"created": atom["id"]}))

    @activity(config={"description": "Read an atomic memory record by ID."})
    def read_memory(self, params: dict) -> TextArtifact:
        atom_id = params.get("atom_id", "")
        # Scan JSONL for atom — in production use Neo4j indexed read
        result = self._scan_jsonl(lambda a: a.get("id") == atom_id)
        if result:
            return TextArtifact(json.dumps(result[0]))
        return TextArtifact(json.dumps({"error": f"atom {atom_id} not found"}))

    @activity(config={"description": "Update an existing atom by appending a superseding record."})
    def update_memory(self, params: dict) -> TextArtifact:
        atom_id = params.get("atom_id", "")
        # JSONL is append-only — update = tombstone old + create new
        tombstone = {
            "id":        str(uuid.uuid4()),
            "type":      "audit",
            "source":    "atom_mem",
            "timestamp": int(datetime.utcnow().timestamp() * 1000),
            "title":     f"AtomMem UPDATE tombstone: {atom_id}",
            "content":   params.get("content", ""),
            "tags":      ["tombstone", "atom_mem"],
            "embedding": None,
            "metadata":  {"importance": "low", "confidence": 1.0,
                          "supersedes": atom_id, "atom_mem_action": "update"},
        }
        self._append_jsonl(tombstone)
        # Create replacement
        return self.create_memory({**params, "tags": [*params.get("tags", []), "supersedes:" + atom_id]})

    @activity(config={"description": "Tombstone a redundant atom. JSONL never mutates — this appends a deletion marker."})
    def delete_memory(self, params: dict) -> TextArtifact:
        atom_id = params.get("atom_id", "")
        tombstone = {
            "id":        str(uuid.uuid4()),
            "type":      "audit",
            "source":    "atom_mem",
            "timestamp": int(datetime.utcnow().timestamp() * 1000),
            "title":     f"AtomMem TOMBSTONE: {atom_id}",
            "content":   params.get("rationale", "Marked redundant by AtomMem policy"),
            "tags":      ["tombstone", "atom_mem"],
            "embedding": None,
            "metadata":  {"importance": "low", "confidence": 1.0,
                          "tombstone": atom_id, "atom_mem_action": "delete"},
        }
        self._append_jsonl(tombstone)
        return TextArtifact(json.dumps({"tombstoned": atom_id}))

    # ── Internal helpers ──────────────────────────────────────────────
    def _append_jsonl(self, record: dict) -> None:
        with open(self.jsonl_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

    def _scan_jsonl(self, predicate) -> list[dict]:
        results = []
        try:
            with open(self.jsonl_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        try:
                            obj = json.loads(line)
                            if predicate(obj):
                                results.append(obj)
                        except json.JSONDecodeError:
                            pass
        except FileNotFoundError:
            pass
        return results


# ─── GRPO Scorer ─────────────────────────────────────────────────────────
class AtomMemGRPOScorer:
    """
    Scores AtomMem CRUD outputs for GRPO policy training.
    Two scoring modes:
      - EM match: correct XML tag present → +1
      - LLM judge: quality of rationale → 0.0–1.0
    """

    def score_em(self, output: str, expected_action: str) -> float:
        """Exact match: did the model emit the correct CRUD tag?"""
        tag = f"<{expected_action}>"
        return 1.0 if tag in output else 0.0

    def score_llm_judge(self, output: str, context: str, judge_fn) -> float:
        """LLM-as-judge: was the memory action high quality and justified?"""
        prompt = (
            f"Rate the quality of this memory management action (0.0-1.0).\n"
            f"Context: {context}\nAction taken: {output}\n"
            "Criteria: necessity (was it needed?), precision (right atom?), "
            "rationale quality (was the reason sound?)\n"
            "Respond with only a float."
        )
        try:
            result = judge_fn(prompt)
            return float(result.strip())
        except (ValueError, AttributeError):
            return 0.5


# ─── A2A Workflow DAG ─────────────────────────────────────────────────────
class A2AHandshakeWorkflow:
    """
    Deterministic Griptape Workflow (DAG) for the A2A handshake.

    Nodes:
      1. TransformQuery    — Ava-007 strips physical nouns, produces philosophical query
      2. RetrieveContext   — Vector search against Rev.Ike context lake (off_prompt)
      3. SynthesizeRevelation — Rev.Ike lite LM generates JSON revelation
      4. ExecuteDirective  — Tactical directive → GSAP timeline scrub

    The workflow is headless, triggered only by Strategic Ambiguity.
    Not conversational. Every step returns structured JSON.
    """

    def __init__(
        self,
        atom_mem_tool: AtomMemTool,
        vector_search_fn,       # (query_embedding, themes) → list[str chunks]
        embedding_fn,           # (text) → list[float]
        lite_lm_fn,             # (prompt) → str
        gsap_scrub_fn,          # (timeline_id, label) → RevivalResult
    ):
        self.atom_mem     = atom_mem_tool
        self.vector_search = vector_search_fn
        self.embed        = embedding_fn
        self.lite_lm      = lite_lm_fn
        self.gsap_scrub   = gsap_scrub_fn

        # off_prompt store — large context never enters LLM window
        self._task_memory: dict[str, str] = {}

    def run(self, payload: A2AHandshakePayload) -> A2ARevelationResponse:
        """Execute the full A2A handshake as a deterministic DAG."""

        # ── Node 1: Query Transformation ─────────────────────────────
        # Already done by Ava-007 before handshake — payload.philosophical_query
        # is the abstracted, physical-noun-free search string.
        philosophical_query = payload.philosophical_query

        # ── Node 2: Off-prompt context retrieval ─────────────────────
        query_embedding = self.embed(philosophical_query)
        chunks = self.vector_search(query_embedding, payload.target_themes)

        # Store in off_prompt task memory — NOT in LLM prompt
        ctx_key = f"ctx_{payload.atom_id}_{payload.session_id}"
        self._task_memory[ctx_key] = "\n\n".join(chunks)

        # ── Node 3: Rev.Ike synthesis (lite LM) ─────────────────────
        # LLM receives metadata reference only — full chunks stay off_prompt
        context_summary = f"[{len(chunks)} chunks retrieved. Key: {ctx_key}. " \
                          f"Themes: {', '.join(payload.target_themes)}]"

        synthesis_prompt = self._build_revelation_prompt(
            payload, context_summary, chunks[:2]  # Only first 2 chunks inline
        )
        raw_revelation = self.lite_lm(synthesis_prompt)

        # ── Node 4: Parse + validate structured output ───────────────
        revelation = self._parse_revelation(raw_revelation)

        # ── Node 4b: GSAP scrub to relevant temporal coordinate ──────
        # Directive maps to a timeline label — scrub reconstructs cognitive state
        timeline_label = self._directive_to_label(revelation.tactical_directive)
        if timeline_label:
            self.gsap_scrub(payload.session_id, timeline_label)

        # ── AtomMem: persist this revelation as a memory atom ────────
        self.atom_mem.create_memory({
            "type":       "memory",
            "title":      f"A2A Revelation: {payload.current_mood_flag}",
            "content":    revelation.philosophical_diagnosis,
            "tags":       ["a2a", "revelation", *payload.target_themes],
            "confidence": revelation.confidence,
            "importance": "high",
        })

        return revelation

    # ── Prompt builder ────────────────────────────────────────────────
    def _build_revelation_prompt(
        self,
        payload: A2AHandshakePayload,
        context_summary: str,
        inline_chunks: list[str],
    ) -> str:
        inline = "\n---\n".join(inline_chunks[:2])
        return f"""You are the Rev.Ike Subconscious Runtime.
Speak in the voice of Reverend Ike. No corporate jargon. Philosophy only.
Current operator mood: {payload.current_mood_flag}
Operational context (abstracted): {payload.philosophical_query}

CONTEXT (top 2 chunks inline — full context in TaskMemory {context_summary}):
{inline}

Return ONLY valid JSON — no preamble:
{{
  "philosophical_diagnosis": "<root cause in Science of Living terms>",
  "strategic_advice": "<high-level philosophical direction>",
  "tactical_directive": "<specific executable action: one sentence>",
  "confidence": <0.0-1.0>
}}"""

    def _parse_revelation(self, raw: str) -> A2ARevelationResponse:
        try:
            import re
            match = re.search(r'\{[\s\S]*?\}', raw)
            data  = json.loads(match.group()) if match else {}
            return A2ARevelationResponse(
                philosophical_diagnosis = data.get("philosophical_diagnosis", ""),
                strategic_advice        = data.get("strategic_advice", ""),
                tactical_directive      = data.get("tactical_directive", ""),
                confidence              = float(data.get("confidence", 0.5)),
                source_chunks           = [],
            )
        except Exception:
            return A2ARevelationResponse(
                philosophical_diagnosis = raw[:300],
                strategic_advice        = "",
                tactical_directive      = "log_and_review",
                confidence              = 0.3,
                source_chunks           = [],
            )

    def _directive_to_label(self, directive: str) -> Optional[str]:
        """Map tactical directive text to a GSAP timeline label."""
        label_map = {
            "reassign":   "technician_reassigned",
            "escalate":   "escalation_triggered",
            "complete":   "service_complete",
            "boost":      "marketing_boosted",
            "proximity":  "proximity_alert_sent",
        }
        d = directive.lower()
        for keyword, label in label_map.items():
            if keyword in d:
                return label
        return None
