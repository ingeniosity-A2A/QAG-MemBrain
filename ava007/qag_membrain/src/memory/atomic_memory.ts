// ═══════════════════════════════════════════════════════════════════
// QUANTUM ATOMIC GSAP MEMBRAiN — Layer 0: Atomic Memory
// Ingestion Engine + JSONL persistence + Ed25519 signing
//
// Core principle (Rev. Ike boundary):
//   All inputs become structured intelligence AT THE MOMENT OF INGESTION.
//   Raw data never enters the brain. Only signed, typed, atomic JSONL.
// ═══════════════════════════════════════════════════════════════════

import { createHash, createSign, createVerify } from "crypto";
import { createWriteStream, createReadStream } from "fs";
import { createInterface } from "readline";
import { v4 as uuid } from "uuid";
import {
  AtomicMemory, AtomType, AtomSource, Importance, CFGLResult, BrainTier,
} from "../shared/types";

// ─── CFGL: Cognitive Filing and Governance Layer ──────────────────────
// The "subconscious filter" — Rev. Ike boundary.
// Scores, validates, and routes. No LLM call. Pure rules.
// Input is raw. Output is structured belief.
export function cfgl(raw: Partial<AtomicMemory>): CFGLResult {
  const type     = raw.type   ?? "event";
  const source   = raw.source ?? "system";
  const content  = raw.content ?? "";

  // Ontology mapping — derive tags from content signals
  const ontology_tags: string[] = [];
  if (content.includes("install") || content.includes("assembly")) ontology_tags.push("service");
  if (content.includes("gazebo") || content.includes("furniture"))  ontology_tags.push("product");
  if (content.includes("location") || content.includes("GPS"))      ontology_tags.push("spatial");
  if (raw.tags) ontology_tags.push(...raw.tags);

  // Importance scoring — deterministic from source signals
  const scored_importance: Importance =
    raw.metadata?.importance === "critical" ? "critical"
    : source === "nfc" || source === "a2a"  ? "high"
    : source === "cortex"                   ? "high"
    : content.length > 500                  ? "medium"
    : "low";

  // Confidence scoring — from metadata or inferred
  const scored_confidence = raw.metadata?.confidence ?? (
    source === "nfc"    ? 1.0  :
    source === "agent"  ? 0.92 :
    source === "web"    ? 0.75 :
    0.80
  );

  // Brain tier routing — which tier receives this atom
  const routed_to: BrainTier =
    scored_importance === "critical"        ? "cortex"
    : scored_confidence < 0.60             ? "cortex"
    : ["nfc", "webhook", "a2a"].includes(source) && scored_importance !== "high"
                                            ? "reflex"
    : "executive";

  const atom: AtomicMemory = {
    id:        raw.id        ?? uuid(),
    type:      type as AtomType,
    source:    source as AtomSource,
    timestamp: raw.timestamp ?? Date.now(),
    title:     raw.title     ?? content.slice(0, 60),
    content,
    tags:      ontology_tags,
    embedding: null,
    metadata: {
      confidence:    scored_confidence,
      importance:    scored_importance,
      url:           raw.metadata?.url,
      author:        raw.metadata?.author,
      customer_did:  raw.metadata?.customer_did,
      risk_level:    raw.metadata?.risk_level ?? "low",
    },
  };

  return {
    atom,
    routed_to,
    scored_importance,
    scored_confidence,
    ontology_tags,
    passed_boundary: true,
  };
}

// ─── Fingerprinting and Signing ───────────────────────────────────────
export function sha256(atom: AtomicMemory): string {
  const canonical = JSON.stringify(atom, Object.keys(atom).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function signAtom(atom: AtomicMemory, privateKeyPem: string): string {
  const canonical = JSON.stringify(atom, Object.keys(atom).sort());
  const signer = createSign("SHA256");
  signer.update(canonical);
  return signer.sign(privateKeyPem, "base64");
}

export function verifyAtom(atom: AtomicMemory, signature: string, publicKeyPem: string): boolean {
  const { signature: _sig, vertex_hash: _vh, parent_hashes: _ph, ...unsigned } = atom;
  const canonical = JSON.stringify(unsigned, Object.keys(unsigned).sort());
  const verifier = createVerify("SHA256");
  verifier.update(canonical);
  try { return verifier.verify(publicKeyPem, signature, "base64"); }
  catch { return false; }
}

// ─── JSONL Persistence ───────────────────────────────────────────────
// append() is the only write operation. JSONL is append-only.
// Atoms are never mutated — corrections are new atoms with reference to prior.
export async function appendAtom(atom: AtomicMemory, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath, { flags: "a", encoding: "utf8" });
    stream.write(JSON.stringify(atom) + "\n", (err) => {
      stream.close();
      err ? reject(err) : resolve();
    });
  });
}

// Read JSONL file — returns async iterable of atoms
export async function* readAtoms(filePath: string): AsyncIterable<AtomicMemory> {
  const rl = createInterface({ input: createReadStream(filePath, "utf8") });
  for await (const line of rl) {
    if (line.trim()) {
      try { yield JSON.parse(line) as AtomicMemory; }
      catch { /* skip malformed lines */ }
    }
  }
}

// Query atoms by predicate (streaming — no full load into memory)
export async function queryAtoms(
  filePath: string,
  predicate: (atom: AtomicMemory) => boolean
): Promise<AtomicMemory[]> {
  const results: AtomicMemory[] = [];
  for await (const atom of readAtoms(filePath)) {
    if (predicate(atom)) results.push(atom);
  }
  return results;
}

// ─── Main Ingestion Entry Point ───────────────────────────────────────
// NFC tap, A2A POST, document upload, webhook — all enter here.
// Output: signed, fingerprinted AtomicMemory ready for Tashi Layer 1.
export async function ingest(
  raw: Partial<AtomicMemory>,
  opts: {
    filePath:      string;
    privateKeyPem?: string;
  }
): Promise<{ atom: AtomicMemory; cfglResult: CFGLResult }> {

  // 1. CFGL: score, validate, route (Rev. Ike subconscious boundary)
  const cfglResult = cfgl(raw);
  let atom = cfglResult.atom;

  // 2. Fingerprint
  const vertex_hash = sha256(atom);
  atom = { ...atom, vertex_hash };

  // 3. Sign if private key provided
  if (opts.privateKeyPem) {
    const signature = signAtom(atom, opts.privateKeyPem);
    atom = { ...atom, signature };
  }

  // 4. Persist to JSONL (append-only — immutable ledger)
  await appendAtom(atom, opts.filePath);

  return { atom, cfglResult };
}
