# Forged-Ingestion-Box

**First-class FORGEDXFILING primitive.**  
Every process — on device, PWA, Agent Browser, Ava console — **starts here**.

Not a chatbot. Not page-local chrome. The single multimodal intake surface.

---

## Law

```text
No console, browser, or PWA may initiate intake, LENS, parse, curate,
or remember without emitting a ForgedIngestEvent through Forged-Ingestion-Box.
```

| Surface | Must use Forged-Ingestion-Box |
|---------|--------------------------------|
| Ava007 console | Yes |
| Agent Browser / Aether | Yes |
| Omni PWA (S26) | Yes |
| Desktop / Linux browser computer | Yes |
| FORGEDxFolder / Bento | Yes |
| ESA / domain skill UIs | Yes (same box, domain routing) |

---

## Architecture

```text
FORGEDXFILING
        │
 ┌──────▼──────┐
 │ INGESTION   │  ← Forged-Ingestion-Box
 │    BOX      │
 └──────┬──────┘
        │  ForgedIngestEvent
┌───────┼────────────────┐
│       │                │
Camera  Files           URLs / repos
│       │                │
▼       ▼                ▼
LENS   Doc/Parse      Web/Repo extract
│       │                │
└───────┼────────────────┘
        ▼
 Sovereign Ingestion → Rev.Ike → curation → graph
        │
   Files · Memory · Intelligence
        │
   Bento / Aetheris
```

---

## Envelope (canonical)

```typescript
type ForgedIngestSource =
  | "text"
  | "camera"
  | "gallery"
  | "document"
  | "url"
  | "github"
  | "huggingface";

type ForgedIngestEvent = {
  source: ForgedIngestSource;
  payload: unknown;
  intent?: string;
  provenance: {
    capturedAt: string;       // ISO-8601
    device?: string;
    sourceUri?: string;
    surface: "pwa" | "console" | "browser" | "aether" | "bento" | string;
  };
  routing: {
    lens?: boolean;
    parse?: boolean;
    curate?: boolean;
    remember?: boolean;
  };
};
```

Emit **ingestion envelopes**, not chat messages.

---

## UI hierarchy

1. **Primary:** Camera / Gallery capture (on-device first)  
2. **Secondary:** PDF / Doc, Web link, drop zone  
3. **Text field:** “Ask, attach, capture, or paste anything…” → still emits `source: "text"` envelope  
4. **Footer tools:** LENS · GitHub · Hugging Face · OpenRouter · UI — providers are **implementation**, not brand chrome  

**Do not** label the box with a model name (no “Aurora”, no vendor identity).  
Expose **FORGED LENS** / **LENS · Unified**; models stay behind the adapter.

---

## On-device

- Camera / Gallery path runs on the device (S26 Termux / PWA).  
- LENS may run local stub, API, or GPU host — routing flags decide.  
- Same envelope schema offline or online.

---

## Implementation map

| Layer | Location |
|-------|----------|
| Contract (TS) | `packages/ingestion-box/types.ts` (this repo) |
| Shared UI | Omni `components/ForgedIngestionBox.*` |
| PWA host | Omni `browser/pwa/` |
| Agent Browser | Omni `browser/aether-browser.html` + future Bento |
| Pipeline consumer | Sovereign Ingestion → DocLang / Rev.Ike |

---

## Related

- [FORGEDXFILING.md](FORGEDXFILING.md)  
- Omni Lens: `docs/CYBERNETIC_LENS_SYSTEM.md`  
- DocLang adapter: Omni `lens/adapters/unstructured-to-doclang.ts`  
