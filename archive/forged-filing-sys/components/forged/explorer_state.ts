// components/forged/explorer_state.ts
// Forged File Explorer — binding UI state model (docs/FORGED_FILE_STANDARD.md §10).
//
// Canvas contract: the existing file explorer is re-skinned and re-architected on
// its OWN primitives (title/path bar, left nav, central canvas, grid/list, crumbs,
// search, sorting, inspector, status bar, data island). No new unrelated UI.
//
// Palette lock (§9): three colors only — neutral / orange / yellow.
// Animation semantics (§9): ripple · gsap-split · odometer · slide · dev-locked-visible-inert.

export const FFS_SPEC_VERSION = "1.2.0";

/** Three colors only. No fourth semantic accent. */
export type FfsColor = "neutral" | "orange" | "yellow";

/** Lifecycle + store + vendor zones mapped onto the left navigation. */
export type ExplorerZone =
  | "f0_raw"
  | "f1_chunk"
  | "f2_forged"
  | "f3_manifest"
  | "rocksdb_skills"    // orange
  | "duckdb_intelligence" // yellow
  | "hf_vendor"         // neutral (vendor storage)
  | "capability"        // orange (executable)
  | "quarantine";       // neutral (system infrastructure)

/** Which semantic color a zone renders with — binding. */
export const ZONE_COLORS: Record<ExplorerZone, FfsColor> = {
  f0_raw: "neutral",
  f1_chunk: "neutral",
  f2_forged: "neutral",
  f3_manifest: "neutral",
  rocksdb_skills: "orange",
  duckdb_intelligence: "yellow",
  hf_vendor: "neutral",
  capability: "orange",
  quarantine: "neutral",
};

export type Stage = "F0" | "F1" | "F2" | "F3";

/** Immutable matrix (§3) surfaced in the UI. */
export const IMMUTABILITY: Record<Stage, { mutable: boolean }> = {
  F0: { mutable: false },
  F1: { mutable: false },
  F2: { mutable: false },
  F3: { mutable: false }, // append-only
};

export type Destination = "ROCKSDB" | "DUCKDB" | "VENDOR" | "QUARANTINE" | "NONE";

/** One card in the central canvas — a governed artifact, not "invoice-014.pdf / 128 KB". */
export interface ForgedAssetCard {
  id: string;                 // forged_id (may carry :vN)
  stage: Stage;
  title: string;              // e.g. "PDF Smart Extractor"
  subtitle: string;           // e.g. "FORGED FILE"
  destination: Destination;   // ROCKSDB | DUCKDB | VENDOR | …
  confidence: number;         // 0..1 — odometer readout
  chunks: number;             // odometer readout
  sizeBytes: number;
  domain: string;
  source: string;
  createdAt: string;          // ISO-8601
  devLocked: boolean;         // visible · inert · reduced opacity + lock glyph
  devLockReason?: string;
}

/** Inspector = control/provenance panel (binding shape). */
export interface InspectorModel {
  forgedFile: {
    forgedId: string;
    sourceUpload: string;
    chunkRange: [number, number];
    engine: "GSAP Split Text";
    destination: Destination;
    confidence: number;
    created: string;
    devStatus: "operational" | "dev-locked";
  };
  provenance: {
    chain: ["F0 Raw Upload", "F1 Chunk", "F2 Forged File", "F3 Manifest"];
    sha256: string;
    rawSidecar: string;
  };
  capability: {
    dependencies: Record<string, string>;
    tools: Record<string, unknown>;    // what it can use/do
    skill: Record<string, unknown>;
    harness: Record<string, unknown>;  // execution boundary INSIDE the capability
  } | null;
}

/** Status bar = manifest summary + DEV-lock count. */
export interface StatusBarModel {
  manifestSummary: {
    totalFiles: number;
    totalChunks: number;
    skillsChunks: number;      // orange
    intelligenceChunks: number; // yellow
  };
  devLockedCount: number;
}

/** Self-contained data island — no external backend. */
export interface ExplorerState {
  vaultRoot: string;
  zone: ExplorerZone;
  viewMode: "grid" | "list";
  breadcrumbs: string[];
  search: string;
  sort: {
    key: "forged_at" | "confidence" | "chunks" | "size";
    direction: "asc" | "desc";
  };
  cards: ForgedAssetCard[];
  selectedId: string | null;
  inspector: InspectorModel | null;
  statusBar: StatusBarModel;
  /** Animation tokens, so the re-skin binds behavior to data, not decoration. */
  animation: {
    upload: "ascii_glitch_ripple";
    f1_chunk: "gsap_split_text";
    numeric: "odometer";
    stage_transition: "slide";
    dev_locked: "visible_inert_reduced_opacity_lock_glyph";
  };
}

/** Breadcrumb for a zone: `vault / F2 Forged / {file_id}`. */
export function breadcrumbsFor(vaultRoot: string, zone: ExplorerZone, id?: string): string[] {
  const crumbs = [vaultRoot, ZONE_LABELS[zone]];
  return id ? [...crumbs, id] : crumbs;
}

export const ZONE_LABELS: Record<ExplorerZone, string> = {
  f0_raw: "F0 Raw",
  f1_chunk: "F1 Chunk",
  f2_forged: "F2 Forged",
  f3_manifest: "F3 Manifest",
  rocksdb_skills: "RocksDB / Skills",
  duckdb_intelligence: "DuckDB / Intelligence",
  hf_vendor: "Hugging Face / Vendor",
  capability: "Capability (Tools + Harness)",
  quarantine: "Quarantine",
};

/** Filters/search per contract: id, source, domain, destination. */
export function filterCards(cards: ForgedAssetCard[], search: string): ForgedAssetCard[] {
  const q = search.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter(
    (c) =>
      c.id.toLowerCase().includes(q) ||
      c.source.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      c.destination.toLowerCase().includes(q),
  );
}

/** Sorting per contract: forged_at | confidence | chunks | size. */
export function sortCards(
  cards: ForgedAssetCard[],
  sort: ExplorerState["sort"],
): ForgedAssetCard[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...cards].sort((a, b) => {
    switch (sort.key) {
      case "forged_at":
        return dir * a.createdAt.localeCompare(b.createdAt);
      case "confidence":
        return dir * (a.confidence - b.confidence);
      case "chunks":
        return dir * (a.chunks - b.chunks);
      case "size":
        return dir * (a.sizeBytes - b.sizeBytes);
      default:
        return 0;
    }
  });
}

/** DEV-locked surfaces: visible, inert, reduced opacity + lock glyph (§9). */
export const DEV_LOCKED_CLASSES = "opacity-40 pointer-events-none select-none";

export function devLockGlyphClasses(enabled: boolean): string {
  return enabled ? DEV_LOCKED_CLASSES : "";
}

/** Build a card from the pipeline's CLI JSON output (forges stay out of the UI bundle). */
export function cardFromForgeOutput(forJson: {
  file_id: string;
  chunk_count: number;
  skills_keys: number[];
  intelligence_keys: number[];
  forged_at: string;
}): ForgedAssetCard {
  const destination: Destination =
    forJson.skills_keys.length > 0 ? "ROCKSDB" : "DUCKDB";
  return {
    id: forJson.file_id,
    stage: "F2",
    title: forJson.file_id,
    subtitle: "FORGED FILE",
    destination,
    confidence: 1,
    chunks: forJson.chunk_count,
    sizeBytes: 0,
    domain: "general",
    source: "",
    createdAt: forJson.forged_at,
    devLocked: false,
  };
}
