// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Lite Notebook LM
//
// The "lite LM" in the subconscious architecture.
// NOT a full reasoning model. A fast ROUTER.
//
// Responsibility:
//   Given a query (semantic, temporal, or label-based), determine
//   WHICH timeline + WHICH temporal coordinate to revive.
//   Then delegate revival to RevIkeRevival.
//
// This achieves motion-based neural compression:
//   - No large context windows loaded
//   - No full state objects persisted
//   - Only easing math curves stored
//   - Lite LM routes to the right curve set
//   - HolographicReconstructor does the math
//   - Result = reconstructed cognitive state in milliseconds
//
// The lite LM also manages the "Notebook" — an index of
// timeline labels and atom metadata for fast semantic routing.
// ═══════════════════════════════════════════════════════════════════

import { RevIkeRevival, RevivalResult } from "./gsap_temporal";
import { TimelineDefinition, TweenAtom, AtomicMemory, TemporalCoordinate } from "../shared/types";

const MELLUM2_ENDPOINT = process.env.MELLUM2_ENDPOINT ?? "http://localhost:11434/api/generate";

// ─── Notebook entry — index of stored timelines ───────────────────────
interface NotebookEntry {
  timeline_id:  string;
  session_id:   string;
  labels:       string[];                        // named temporal anchors
  atom_summary: Array<{                          // lightweight index
    id: string; property: string;
    start_time: number; easing: string;
    cognitive_weight: number;
  }>;
  created_at:   number;
  tags:         string[];
}

// ─── Revival query types ──────────────────────────────────────────────
export type RevivalQuery =
  | { mode: "label";    timeline_id: string; label: string }
  | { mode: "temporal"; timeline_id: string; at: number }
  | { mode: "semantic"; concept: string }
  | { mode: "nearest";  timeline_id: string; property: string; target_value: number };

export interface LiteRoutingResult {
  query:         RevivalQuery;
  routed_to:     { timeline_id: string; temporal_coordinate: number; label?: string };
  revival:       RevivalResult | null;
  routing_ms:    number;
  model_used:    "rule" | "lite_lm";
}

// ─── Lite Notebook LM ─────────────────────────────────────────────────
export class LiteNotebookLM {
  private notebook = new Map<string, NotebookEntry>();
  private revival:  RevIkeRevival;

  constructor(revival: RevIkeRevival) {
    this.revival = revival;
  }

  // ── Register a timeline in the notebook ──────────────────────────
  register(definition: TimelineDefinition, tags: string[] = []): void {
    this.revival.archive(definition);

    const entry: NotebookEntry = {
      timeline_id:  definition.id,
      session_id:   definition.session_id,
      labels:       Object.keys(definition.labels),
      atom_summary: definition.atoms.map(a => ({
        id:               a.id,
        property:         a.property,
        start_time:       a.start_time,
        easing:           a.easing_name,
        cognitive_weight: a.cognitive_weight,
      })),
      created_at: definition.created_at,
      tags,
    };

    this.notebook.set(definition.id, entry);
  }

  // ── Route a query to the correct timeline + temporal coordinate ───
  async route(query: RevivalQuery): Promise<LiteRoutingResult> {
    const start = Date.now();

    switch (query.mode) {

      // Label mode: O(1) lookup — no LLM needed
      case "label": {
        const revival = this.revival.reviveByLabel({
          timelineId: query.timeline_id,
          label:      query.label,
        });
        return {
          query,
          routed_to: {
            timeline_id:        query.timeline_id,
            temporal_coordinate: revival?.temporal_coordinate ?? 0,
            label:              query.label,
          },
          revival,
          routing_ms: Date.now() - start,
          model_used: "rule",
        };
      }

      // Temporal mode: direct coordinate seek — no LLM needed
      case "temporal": {
        const revival = this.revival.revive({
          timelineId: query.timeline_id,
          at:         query.at,
        });
        return {
          query,
          routed_to: { timeline_id: query.timeline_id, temporal_coordinate: query.at },
          revival,
          routing_ms: Date.now() - start,
          model_used: "rule",
        };
      }

      // Nearest-value mode: find atom matching target value — no LLM
      case "nearest": {
        const revival = this.revival.reviveNearest({
          timelineId: query.timeline_id,
          queryFn:    (atom: TweenAtom) =>
            atom.property === query.property
              ? 1 - Math.abs(atom.to_value - query.target_value)
              : -Infinity,
        });
        return {
          query,
          routed_to: {
            timeline_id:        query.timeline_id,
            temporal_coordinate: revival?.temporal_coordinate ?? 0,
          },
          revival,
          routing_ms: Date.now() - start,
          model_used: "rule",
        };
      }

      // Semantic mode: lite LM routes concept → timeline + coordinate
      case "semantic": {
        const route = await this.semanticRoute(query.concept);
        if (!route) {
          return {
            query, routed_to: { timeline_id: "", temporal_coordinate: 0 },
            revival: null, routing_ms: Date.now() - start, model_used: "lite_lm",
          };
        }
        const revival = this.revival.revive({
          timelineId: route.timeline_id,
          at:         route.temporal_coordinate,
        });
        return {
          query,
          routed_to: route,
          revival,
          routing_ms: Date.now() - start,
          model_used: "lite_lm",
        };
      }
    }
  }

  // ── Semantic routing via lite LM ──────────────────────────────────
  // LM reads the notebook index (lightweight — atom summaries, labels)
  // and selects the best timeline + temporal coordinate.
  // This is the ONLY point where an LLM call happens in the temporal layer.
  private async semanticRoute(
    concept: string
  ): Promise<{ timeline_id: string; temporal_coordinate: number; label?: string } | null> {

    const notebookIndex = Array.from(this.notebook.values()).map(e => ({
      id:       e.timeline_id,
      labels:   e.labels,
      tags:     e.tags,
      atoms:    e.atom_summary.slice(0, 10), // send only top 10 — keep prompt small
    }));

    const prompt = `You are a lightweight memory router for the QAG_MemBrain system.
Given a semantic concept, identify which stored timeline and temporal coordinate to revive.
Choose the most relevant label if one exists; otherwise estimate the best timestamp.

SEMANTIC QUERY: "${concept}"

NOTEBOOK INDEX (available timelines):
${JSON.stringify(notebookIndex, null, 2).slice(0, 2000)}

Respond ONLY with JSON — no preamble:
{
  "timeline_id": "<id from notebook>",
  "temporal_coordinate": <unix_ms>,
  "label": "<label_name or null>"
}
If no match, return: { "timeline_id": null }`;

    try {
      const resp = await fetch(MELLUM2_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ model: "mellum2", prompt, stream: false, format: "json" }),
      });
      if (!resp.ok) return null;
      const data   = await resp.json();
      const parsed = JSON.parse(data.response);
      if (!parsed.timeline_id) return null;
      return parsed;
    } catch {
      // Fallback: return first notebook entry at its start time
      const first = Array.from(this.notebook.values())[0];
      return first
        ? { timeline_id: first.timeline_id, temporal_coordinate: first.created_at }
        : null;
    }
  }

  // ── Distributed temporal coherence ───────────────────────────────
  // Returns the minimal "temporal cognition signature" for mesh sync.
  // Remote nodes reconstruct identical state from (timeline_id, t, seed).
  // No embedding transfer. No state blob. Just math curve references.
  exportSignature(timelineId: string, t: TemporalCoordinate): TemporalSignature | null {
    const entry = this.notebook.get(timelineId);
    if (!entry) return null;
    return {
      timeline_id: timelineId,
      temporal_coordinate: t,
      seed: entry.created_at,          // deterministic seed for reproduction
      atom_count: entry.atom_summary.length,
      labels: entry.labels,
      // Remote node uses this signature + its own copy of the timeline definition
      // to deterministically reconstruct identical state. Zero data transfer.
    };
  }

  importAndRevive(signature: TemporalSignature): RevivalResult | null {
    return this.revival.revive({
      timelineId: signature.timeline_id,
      at:         signature.temporal_coordinate,
    });
  }

  get notebookSize(): number { return this.notebook.size; }
}

// ─── Temporal signature (mesh sync primitive) ─────────────────────────
export interface TemporalSignature {
  timeline_id:         string;
  temporal_coordinate: TemporalCoordinate;
  seed:                number;
  atom_count:          number;
  labels:              string[];
}
