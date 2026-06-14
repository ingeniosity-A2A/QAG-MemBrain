"""
QAG_MemBrain — Goose Tactical Execution Layer
=============================================
Goose is the agentic execution muscle for the Technician Swarm.
While Ava-007 is the Station Chief (strategic logic),
Goose bridges the semantic gap: philosophy → material-world action.

Role:
  - Consumes tactical_directive from Rev.Ike revelation
  - Executes across dispatch portals, RCS, A2A endpoints
  - Closes the loop: "metaphysical diagnosis → hardware result"
  - Writes execution receipts back to JSONL atomic memory

Goose in this framework = the actuator layer.
It does not reason. It executes deterministic action plans.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Awaitable
import json, os, time, uuid
import aiohttp


# ─── Swarm action registry ────────────────────────────────────────────
# Each directive maps to a concrete execution function.
# Functions are async, typed, write receipts to JSONL.

ActionFn = Callable[[dict], Awaitable[dict]]

@dataclass
class SwarmAction:
    directive_key:   str          # matches tactical_directive keywords
    description:     str
    execute:         ActionFn


# ─── Built-in swarm actions ───────────────────────────────────────────

async def _reassign_resource(params: dict) -> dict:
    """Reassign technician in dispatch portal. POST to dispatch endpoint."""
    endpoint = os.environ.get("DISPATCH_ENDPOINT", "http://localhost:9000/dispatch")
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(endpoint, json={
                "action":      "reassign",
                "tech_id":     params.get("tech_id"),
                "job_id":      params.get("job_id"),
                "new_origin":  params.get("new_origin"),
                "reason":      "Rev.Ike tactical directive",
            }, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return {"status": resp.status, "dispatched": True}
    except Exception as e:
        return {"status": "error", "error": str(e), "dispatched": False}


async def _send_rcs_update(params: dict) -> dict:
    """Send RCS rich card to customer — arrival update, quote change."""
    endpoint = os.environ.get("RCS_ENDPOINT", "http://localhost:9001/rcs")
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(endpoint, json={
                "recipient": params.get("customer_did"),
                "card_type": "service_update",
                "body":      params.get("message", "Your service is being updated."),
                "actions":   params.get("actions", []),
            }, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return {"status": resp.status, "sent": True}
    except Exception as e:
        return {"status": "error", "error": str(e), "sent": False}


async def _boost_local_landing(params: dict) -> dict:
    """Trigger local SEO page boost for demand spike."""
    endpoint = os.environ.get("SEO_ENDPOINT", "http://localhost:9002/seo")
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(endpoint, json={
                "service":  params.get("service_type"),
                "location": params.get("location"),
                "boost_ms": params.get("boost_duration_ms", 3_600_000),
            }, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return {"status": resp.status, "boosted": True}
    except Exception as e:
        return {"status": "error", "error": str(e), "boosted": False}


async def _trigger_a2a_handoff(params: dict) -> dict:
    """POST structured A2A message to recipient agent endpoint."""
    endpoint = params.get("agent_endpoint", os.environ.get("A2A_ENDPOINT", ""))
    if not endpoint:
        return {"status": "skipped", "reason": "no agent_endpoint provided"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(endpoint, json={
                "jsonrpc": "2.0", "method": "message/send", "id": str(uuid.uuid4()),
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"kind": "text", "text": params.get("message", "")}],
                    }
                }
            }, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                return {"status": resp.status, "sent": True}
    except Exception as e:
        return {"status": "error", "error": str(e), "sent": False}


async def _operator_checkpoint(params: dict) -> dict:
    """Pause execution — create ephemeral portal link for human review."""
    checkpoint_id = str(uuid.uuid4())
    expires_at    = int(time.time() * 1000) + 300_000  # 5 min
    # In production: write to Cloudflare KV / Redis, send SMS
    print(f"[Goose] CHECKPOINT {checkpoint_id} — expires {expires_at}")
    print(f"  Context: {params.get('context', '')[:100]}")
    return {
        "status": "checkpoint_created",
        "checkpoint_id": checkpoint_id,
        "expires_at": expires_at,
        "awaiting_human": True,
    }


# ─── Directive → action mapping ───────────────────────────────────────
SWARM_ACTIONS: list[SwarmAction] = [
    SwarmAction("reassign",          "Reassign technician in dispatch",    _reassign_resource),
    SwarmAction("rcs",               "Send RCS update to customer",         _send_rcs_update),
    SwarmAction("boost",             "Boost local landing page",            _boost_local_landing),
    SwarmAction("a2a",               "POST A2A handoff to agent",           _trigger_a2a_handoff),
    SwarmAction("checkpoint",        "Pause for operator human review",     _operator_checkpoint),
    SwarmAction("operator",          "Pause for operator human review",     _operator_checkpoint),
]


# ─── Goose executor ───────────────────────────────────────────────────
class GooseExecutor:
    """
    Tactical execution layer. Consumes tactical_directive, fires swarm actions.
    Writes execution receipt to JSONL atomic memory.
    Does NOT reason. Does NOT interpret. Executes.
    """

    def __init__(self, jsonl_path: str):
        self.jsonl_path = jsonl_path

    async def execute(
        self,
        tactical_directive: str,
        params:             dict,
        context:            str = "",
    ) -> "ExecutionReceipt":
        """
        Match directive → swarm action → execute → write receipt.
        If no match: log_and_passthrough.
        """
        start = time.time()

        # Find matching action
        action = next(
            (a for a in SWARM_ACTIONS
             if a.directive_key.lower() in tactical_directive.lower()),
            None,
        )

        if action:
            result = await action.execute({**params, "context": context})
        else:
            result = {
                "status": "passthrough",
                "reason": f"No swarm action matched directive: {tactical_directive}",
            }

        latency_ms = int((time.time() - start) * 1000)

        receipt = ExecutionReceipt(
            id              = str(uuid.uuid4()),
            directive       = tactical_directive,
            action_key      = action.directive_key if action else "passthrough",
            result          = result,
            params          = params,
            context         = context[:200],
            latency_ms      = latency_ms,
            timestamp       = int(time.time() * 1000),
            success         = result.get("status") not in ("error", "not_found"),
        )

        await self._write_receipt(receipt)
        return receipt

    async def _write_receipt(self, receipt: "ExecutionReceipt") -> None:
        """Append execution receipt to JSONL — immutable audit trail."""
        atom = {
            "id":        receipt.id,
            "type":      "audit",
            "source":    "goose",
            "timestamp": receipt.timestamp,
            "title":     f"Goose: {receipt.action_key}",
            "content":   json.dumps(receipt.result),
            "tags":      ["goose", "execution", receipt.action_key],
            "embedding": None,
            "metadata": {
                "confidence":   1.0,
                "importance":   "medium",
                "directive":    receipt.directive,
                "latency_ms":   receipt.latency_ms,
                "success":      receipt.success,
            },
        }
        with open(self.jsonl_path, "a") as f:
            f.write(json.dumps(atom) + "\n")


# ─── Execution receipt ────────────────────────────────────────────────
@dataclass
class ExecutionReceipt:
    id:          str
    directive:   str
    action_key:  str
    result:      dict
    params:      dict
    context:     str
    latency_ms:  int
    timestamp:   int
    success:     bool
