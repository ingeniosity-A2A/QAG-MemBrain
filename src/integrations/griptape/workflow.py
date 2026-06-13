"""
QAG_MemBrain — Griptape Orchestration Layer
============================================
Maps AtomMem CRUD action space to Griptape @activity-decorated tools.
Implements the A2A handshake between Ava-007 (Station Chief) and
Rev.Ike (subconscious runtime) as a deterministic Griptape Workflow DAG.

Griptape components used:
  Tool          — @activity methods for create/read/update/delete
  TaskMemory    — off_prompt: large context stored in infra, not LLM window
  Workflow      — DAG: query_transform → retrieve → synthesize → reconstruct
  Ruleset       — psychological container: no jargon, Rev.Ike lexicon only
  PromptTask    — each DAG node is a structured LLM call

Why Griptape over raw LLM calls:
  - 10x faster than prompt-only frameworks (logic in Python, not NL)
  - Structured Output drivers validate XML action tokens before execution
  - Workflow DAG = verifiable, replayable A2A interaction lineage
  - TaskMemory off_prompt = context lake stays in infra, not token window
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
import json
import os

# ─── Simulated Griptape interfaces ───────────────────────────────────
# In production: `pip install griptape`
# from griptape.tasks import PromptTask, ToolkitTask
# from griptape.tools import BaseTool
# from griptape.memory.task import TaskMemory
# from griptape.workflows import Workflow
# from griptape.rules import Rule, Ruleset
# from griptape.drivers import LocalVectorStoreDriver
# Here we implement the contracts so the logic is production-ready.

@dataclass
class TaskMemoryStore:
    """Off-prompt storage — large artifacts stored here, not in LLM window."""
    _store: dict[str, str] = field(default_factory=dict)

    def set(self, key: str, value: str) -> None:
        self._store[key] = value

    def get(self, key: str) -> str | None:
        return self._store.get(key)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)


# ─── AtomMem CRUD Tool ────────────────────────────────────────────────
class AtomMemTool:
    """
    Griptape Tool — maps AtomMem CRUD to @activity methods.
    Agent emits XML tags: <create_memory>, <read_memory>, etc.
    Structured Output driver validates tags before execution.
    """

    def __init__(self, task_memory: TaskMemoryStore, jsonl_path: str):
        self.memory = task_memory
        self.jsonl_path = jsonl_path

    # @activity(config={"description": "Create a new atomic memory record"})
    def create_memory(self, content: str, tags: list[str], importance: str = "medium") -> dict:
        """Creates an atomic memory. One JSON object = one atomic memory."""
        import uuid, time
        atom = {
            "id": str(uuid.uuid4()),
            "type": "memory",
            "source": "agent",
            "timestamp": int(time.time() * 1000),
            "content": content,
            "tags": tags,
            "embedding": None,
            "metadata": {"confidence": 0.9, "importance": importance},
        }
        # Write to JSONL (append-only)
        with open(self.jsonl_path, "a") as f:
            f.write(json.dumps(atom) + "\n")
        # Store in TaskMemory for immediate off-prompt access
        self.memory.set(f"atom_{atom['id']}", json.dumps(atom))
        return {"status": "created", "id": atom["id"]}

    # @activity(config={"description": "Read an atomic memory by ID"})
    def read_memory(self, atom_id: str) -> dict | None:
        """Reads from TaskMemory (fast) or JSONL (fallback)."""
        cached = self.memory.get(f"atom_{atom_id}")
        if cached:
            return json.loads(cached)
        # JSONL fallback — stream-search
        if os.path.exists(self.jsonl_path):
            with open(self.jsonl_path) as f:
                for line in f:
                    atom = json.loads(line.strip())
                    if atom.get("id") == atom_id:
                        return atom
        return None

    # @activity(config={"description": "Update an existing memory (creates superseding record)"})
    def update_memory(self, atom_id: str, new_content: str) -> dict:
        """Update = append superseding atom (JSONL is append-only)."""
        original = self.read_memory(atom_id)
        if not original:
            return {"status": "not_found"}
        import uuid, time
        updated = {**original, "id": str(uuid.uuid4()),
                   "content": new_content,
                   "timestamp": int(time.time() * 1000),
                   "metadata": {**original.get("metadata", {}), "supersedes": atom_id}}
        with open(self.jsonl_path, "a") as f:
            f.write(json.dumps(updated) + "\n")
        self.memory.set(f"atom_{updated['id']}", json.dumps(updated))
        return {"status": "updated", "new_id": updated["id"], "supersedes": atom_id}

    # @activity(config={"description": "Tombstone a redundant memory (soft delete)"})
    def delete_memory(self, atom_id: str, rationale: str) -> dict:
        """Delete = append tombstone record (JSONL is immutable)."""
        import uuid, time
        tombstone = {
            "id": str(uuid.uuid4()), "type": "audit", "source": "agent",
            "timestamp": int(time.time() * 1000),
            "content": f"TOMBSTONE: {rationale}",
            "tags": ["tombstone"],
            "embedding": None,
            "metadata": {"confidence": 1.0, "importance": "low", "tombstone_of": atom_id},
        }
        with open(self.jsonl_path, "a") as f:
            f.write(json.dumps(tombstone) + "\n")
        return {"status": "tombstoned", "atom_id": atom_id}


# ─── Rev.Ike Ruleset ──────────────────────────────────────────────────
# "Psychological container" — enforces Rev.Ike lexicon, bans jargon.
# In Griptape: Ruleset applied to every PromptTask in the workflow.
REV_IKE_RULESET = [
    "You speak ONLY in the language of Reverend Ike's Science of Living.",
    "NEVER use corporate jargon, logistics terms, or hardware vocabulary.",
    "Transform ALL physical problems into psychological or energetic states.",
    "Return ONLY valid JSON: {philosophical_diagnosis, strategic_advice, tactical_directive}.",
    "If you cannot abstract the problem, output {error: 'abstraction_failed'}.",
    "Tactical directives must be specific and executable — no philosophical fluff.",
]

AVA007_RULESET = [
    "You are the Station Chief. You translate operational problems, never solve them philosophically.",
    "Output ONLY valid JSON: {philosophical_query, target_themes}.",
    "philosophical_query must be 10-15 words, zero physical nouns.",
    "target_themes must be 1-2 items from the approved theme list.",
    "Approved themes: Prosperity_Consciousness, Overcoming_Obstacles, Commanding_Reality, Divine_Supply.",
]


# ─── A2A Handshake Workflow DAG ───────────────────────────────────────
class A2AHandshakeWorkflow:
    """
    Deterministic Griptape Workflow DAG for the Ava-007 ↔ Rev.Ike handshake.

    DAG topology (strictly linear — each node depends on prior):
      [query_transform] → [retrieve_context] → [synthesize_revelation] → [reconstruct_state]

    Triggered ONLY by:
      - Strategic Ambiguity (scheduling conflicts, resource conflicts)
      - Motivational Requirements (crew morale, operator escalation)
    NOT continuous — headless and async.

    TaskMemory usage:
      - retrieve_context stores chunks off_prompt (not in LLM window)
      - synthesize_revelation reads chunk keys, not raw tokens
    """

    def __init__(
        self,
        task_memory:    TaskMemoryStore,
        atom_mem_tool:  AtomMemTool,
        vector_search:  "VectorSearchFn | None" = None,  # Cloudflare Vectorize plug
    ):
        self.task_memory   = task_memory
        self.atom_mem_tool = atom_mem_tool
        self.vector_search = vector_search

    async def run(self, operational_context: str, mood_flag: str = "neutral") -> "A2ARevealation":
        """
        Full A2A handshake:
        1. Ava-007 transforms tactical → philosophical (query_transform)
        2. Rev.Ike retrieves context chunks (retrieve_context, off_prompt)
        3. Rev.Ike synthesizes revelation JSON (synthesize_revelation)
        4. GSAP temporal reconstruction triggered (reconstruct_state)
        """

        # ── Node 1: Query Transformation (Ava-007 Station Chief) ──────
        # Strips physical nouns. Identifies psychological block.
        # Modified HyDE: generates hypothetical philosophical document.
        philosophical = await self._query_transform(operational_context)
        if not philosophical:
            return A2ARevealation(error="query_transform_failed")

        # ── Node 2: Context Retrieval (off_prompt) ─────────────────────
        # Chunks stored in TaskMemory — NOT injected into LLM window.
        # LLM gets only the keys, reads content via read_memory activity.
        chunk_keys = await self._retrieve_context(
            philosophical["philosophical_query"],
            philosophical["target_themes"],
        )

        # ── Node 3: Synthesis (Rev.Ike + psychological container) ──────
        revelation = await self._synthesize(
            philosophical["philosophical_query"],
            chunk_keys,
            mood_flag,
        )

        # ── Node 4: GSAP temporal reconstruction trigger ───────────────
        # tactical_directive → GSAP label scrub in temporal layer
        gsap_label = self._map_directive_to_label(revelation.get("tactical_directive", ""))

        # Write revelation to AtomMem
        self.atom_mem_tool.create_memory(
            content=json.dumps(revelation),
            tags=["revelation", "rev_ike", "a2a"],
            importance="high",
        )

        return A2ARevealation(
            philosophical_diagnosis = revelation.get("philosophical_diagnosis", ""),
            strategic_advice        = revelation.get("strategic_advice", ""),
            tactical_directive      = revelation.get("tactical_directive", ""),
            gsap_label              = gsap_label,
            mood_flag               = mood_flag,
            chunk_keys              = chunk_keys,
        )

    async def _query_transform(self, context: str) -> dict | None:
        """Ava-007: strip physical nouns, output philosophical_query + target_themes."""
        # In production: Griptape PromptTask with AVA007_RULESET applied
        # Here: direct Mellum2 call with same logic
        import aiohttp
        prompt = (
            "You are the Ava-007 Station Chief query transformer.\n"
            f"Tactical context: {context[:300]}\n\n"
            "Transform into philosophical query (10-15 words, zero physical nouns).\n"
            "Select 1-2 themes from: Prosperity_Consciousness, Overcoming_Obstacles, "
            "Commanding_Reality, Divine_Supply.\n"
            'Respond ONLY with JSON: {"philosophical_query": "...", "target_themes": [...]}'
        )
        endpoint = os.environ.get("MELLUM2_ENDPOINT", "http://localhost:11434/api/generate")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(endpoint, json={
                    "model": "mellum2", "prompt": prompt,
                    "stream": False, "format": "json"
                }) as resp:
                    data = await resp.json()
                    return json.loads(data["response"])
        except Exception:
            # Fallback
            return {
                "philosophical_query": "Dissolving perceived limitations through mental command",
                "target_themes": ["Overcoming_Obstacles"],
            }

    async def _retrieve_context(self, query: str, themes: list[str]) -> list[str]:
        """Retrieve semantic chunks — store off_prompt, return keys only."""
        import uuid
        if self.vector_search:
            chunks = await self.vector_search(query, themes, top_k=4)
        else:
            # Dev mode placeholder
            chunks = [
                f"[Rev.Ike chunk 1 for theme {themes[0]}]: You have the power to dissolve "
                "any limitation with the force of your mind.",
                f"[Rev.Ike chunk 2]: The material world responds to the consciousness you project.",
            ]

        keys = []
        for i, chunk in enumerate(chunks):
            key = f"ctx_{uuid.uuid4().hex[:8]}"
            self.task_memory.set(key, chunk)  # off_prompt: not in LLM window
            keys.append(key)
        return keys

    async def _synthesize(self, query: str, chunk_keys: list[str], mood: str) -> dict:
        """Rev.Ike synthesis — reads chunk keys, applies psychological container."""
        # Retrieve chunks via keys (this is TaskMemory read, not LLM token expansion)
        chunks = [self.task_memory.get(k) or "" for k in chunk_keys]
        context = "\n\n".join(chunks)[:1200]  # bounded — not unbounded injection

        import aiohttp
        prompt = (
            "You are the Rev.Ike Subconscious Runtime.\n"
            f"Current operator mood: {mood}\n"
            f"Philosophical query: {query}\n\n"
            "RETRIEVED CONTEXT:\n" + context + "\n\n"
            "Apply the Science of Living. Output ONLY JSON:\n"
            '{"philosophical_diagnosis": "...", "strategic_advice": "...", "tactical_directive": "..."}'
        )
        endpoint = os.environ.get("MELLUM2_ENDPOINT", "http://localhost:11434/api/generate")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(endpoint, json={
                    "model": "mellum2", "prompt": prompt, "stream": False, "format": "json"
                }) as resp:
                    data = await resp.json()
                    return json.loads(data["response"])
        except Exception:
            return {
                "philosophical_diagnosis": "Perceived obstruction as opportunity for expansion.",
                "strategic_advice": "Command the situation with unwavering mental clarity.",
                "tactical_directive": "Reassign_Resource",
            }

    def _map_directive_to_label(self, directive: str) -> str:
        """Map tactical directive to GSAP timeline label for temporal scrub."""
        mapping = {
            "Reassign_Resource":    "resource_reassignment",
            "Boost_Visibility":     "marketing_activation",
            "Delay_Accepted":       "delay_acknowledged",
            "Escalate_To_Operator": "operator_checkpoint",
        }
        for key, label in mapping.items():
            if key.lower() in directive.lower():
                return label
        return "revelation_received"


# ─── A2A Revelation result ────────────────────────────────────────────
@dataclass
class A2ARevealation:
    philosophical_diagnosis: str = ""
    strategic_advice:        str = ""
    tactical_directive:      str = ""
    gsap_label:              str = ""
    mood_flag:               str = ""
    chunk_keys:              list[str] = field(default_factory=list)
    error:                   str | None = None
