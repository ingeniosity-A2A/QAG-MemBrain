// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Layer 0: Atomic Memory
// CFGL + JSONL append-only ledger + Ed25519 signing + SHA-256 fingerprint
// ═══════════════════════════════════════════════════════════════════

import { createHash, createSign, createVerify } from "crypto";
import { createWriteStream, createReadStream }  from "fs";
import { createInterface }                       from "readline";
import { v4 as uuid }                            from "uuid";
import { AtomicMemory, AtomType, AtomSource, Importance, CFGLResult, BrainTier } from "../shared/types";

// ─── CFGL — Cognitive Filing and Governance Layer ────────────────────
// The Rev.Ike subconscious boundary.
// Scores, validates, routes. No LLM. Pure rules.
// Everything above this line is conscious (brain). Below is subconscious.
export function cfgl(raw: Partial<AtomicMemory>): CFGLResult {
  const type    = (raw.type   ?? "event") as AtomType;
  const source  = (raw.source ?? "system") as AtomSource;
  const content = raw.content ?? "";

  const ontology_tags: string[] = [...(raw.tags ?? [])];
  if (/gazebo|install|assembly|bracket/i.test(content)) ontology_tags.push("service");
  if (/GPS|location|arrived|geofence/i.test(content))   ontology_tags.push("spatial");
  if (/handshake|A2A|D\.I\.D|agent/i.test(content))     ontology_tags.push("a2a");

  const scored_importance: Importance =
    raw.metadata?.importance === "critical" ? "critical"
    : ["nfc", "a2a"].includes(source)       ? "high"
    : source === "cortex"                   ? "high"
    : content.length > 500                  ? "medium"
    : "low";

  const scored_confidence =
    raw.metadata?.confidence ??
    (source === "nfc" ? 1.0 : source === "agent" ? 0.92 : source === "web" ? 0.75 : 0.80);

  const routed_to: BrainTier =
    scored_importance === "critical"               ? "cortex"
    : scored_confidence < 0.60                     ? "cortex"
    : ["nfc", "webhook", "a2a"].includes(source)   ? "reflex"
    : "executive";

  const atom: AtomicMemory = {
    id:        raw.id ?? uuid(),
    type,
    source,
    timestamp: raw.timestamp ?? Date.now(),
    title:     raw.title ?? content.slice(0, 60),
    content,
    tags:      ontology_tags,
    embedding: null,
    metadata: {
      confidence:   scored_confidence,
      importance:   scored_importance,
      url:          raw.metadata?.url,
      author:       raw.metadata?.author,
      customer_did: raw.metadata?.customer_did,
      risk_level:   raw.metadata?.risk_level ?? "low",
      prefix_key:   raw.metadata?.prefix_key,
    },
  };

  return { atom, routed_to, scored_importance, scored_confidence, ontology_tags, passed_boundary: true };
}

// ─── Fingerprint + signing ────────────────────────────────────────────
export function sha256(atom: AtomicMemory): string {
  const { signature: _s, vertex_hash: _v, parent_hashes: _p, ...core } = atom;
  return createHash("sha256").update(JSON.stringify(core, Object.keys(core).sort())).digest("hex");
}

export function signAtom(atom: AtomicMemory, privateKeyPem: string): string {
  const { signature: _s, vertex_hash: _v, parent_hashes: _p, ...core } = atom;
  const s = createSign("SHA256");
  s.update(JSON.stringify(core, Object.keys(core).sort()));
  return s.sign(privateKeyPem, "base64");
}

export function verifyAtom(atom: AtomicMemory, sig: string, publicKeyPem: string): boolean {
  const { signature: _s, vertex_hash: _v, parent_hashes: _p, ...core } = atom;
  const v = createVerify("SHA256");
  v.update(JSON.stringify(core, Object.keys(core).sort()));
  try { return v.verify(publicKeyPem, sig, "base64"); } catch { return false; }
}

// ─── JSONL persistence ────────────────────────────────────────────────
// append() is the ONLY write operation. Atoms are never mutated.
export async function appendAtom(atom: AtomicMemory, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath, { flags: "a", encoding: "utf8" });
    stream.write(JSON.stringify(atom) + "\n", (err) => {
      stream.close();
      err ? reject(err) : resolve();
    });
  });
}

export function createEdgeCustomerAtom(input: {
  customerDid: string;
  name: string;
  preferredTech?: string;
  title?: string;
  content?: string;
  tags?: string[];
}): AtomicMemory {
  return {
    id: uuid(),
    type: "memory",
    source: "nfc",
    timestamp: Date.now(),
    title: input.title ?? `Customer: ${input.name}`,
    content: input.content ?? JSON.stringify({
      name: input.name,
      did: input.customerDid,
      preferred_tech: input.preferredTech,
    }),
    tags: input.tags ?? ["customer", "edge_only"],
    embedding: null,
    metadata: {
      confidence: 1.0,
      importance: "high",
      customer_did: input.customerDid,
      edge_only: true,
      risk_level: "low",
    },
  };
}

export async function* readAtoms(filePath: string): AsyncIterable<AtomicMemory> {
  const rl = createInterface({ input: createReadStream(filePath, "utf8") });
  for await (const line of rl) {
    if (line.trim()) {
      try { yield JSON.parse(line) as AtomicMemory; } catch { /* skip malformed */ }
    }
  }
}

// ─── Main ingestion entry point ───────────────────────────────────────
export async function ingest(
  raw:  Partial<AtomicMemory>,
  opts: { filePath: string; privateKeyPem?: string }
): Promise<{ atom: AtomicMemory; cfglResult: CFGLResult }> {
  const cfglResult  = cfgl(raw);
  let   atom        = cfglResult.atom;
  const vertex_hash = sha256(atom);
  atom = { ...atom, vertex_hash };
  if (opts.privateKeyPem) atom = { ...atom, signature: signAtom(atom, opts.privateKeyPem) };
  await appendAtom(atom, opts.filePath);
  return { atom, cfglResult };
}
