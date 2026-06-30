# Consolidation Manifest — ava007-membrain → QAG-MemBrain + Agent-X

**Date:** 2026-06-30
**Source repo:** `ingeniosity-A2A/ava007-membrain` (TO BE DELETED)
**Destinations:** QAG-MemBrain (main) + Agent-X (main)

---

## What Moved Where

### → QAG-MemBrain (MemBrain functions + Rev.Ike)

| Path | What | Rev.Ike Connection |
|------|------|-------------------|
| `skills/zai_sdk/ASR/` | Speech-to-text (ZAI SDK) | Rev.Ike hearing — converts voice to text |
| `skills/zai_sdk/LLM/` | LLM chat (ZAI SDK) | Rev.Ike cognition — general inference |
| `skills/zai_sdk/TTS/` | Text-to-speech (ZAI SDK) | Ava's voice — already have speak.ts, this is the ZAI SDK alternative |
| `skills/zai_sdk/VLM/` | Vision language model | Rev.Ike vision — product photo analysis |
| `skills/zai_sdk/web-search/` | Web search | Goose expansion — internet queries |
| `skills/zai_sdk/web-reader/` | Web page reader | Context ingestion — URL → text |
| `skills/zai_sdk/image-understand/` | Image analysis | Product recognition from photos |
| `skills/zai_sdk/image-generation/` | Image generation | Card rendering — quote visuals |
| `skills/zai_sdk/image-edit/` | Image editing | Product photo enhancement |
| `skills/zai_sdk/video-understand/` | Video analysis | Job site video review |
| `skills/zai_sdk/charts/` | Data visualization | Quote charts, revenue reports |
| `skills/zai_sdk/coding-agent/` | Coding agent | Bastani-like autonomous engineering |
| `examples/websocket/` | WebSocket frontend + server | A2A protocol — device-to-device comms |
| `docs/ava007-membrain-worklog.md` | Worklog history | Audit trail |

### → Agent-X (Help Assembly Services platform)

| Path | What |
|------|------|
| `platform/src/app/` | Next.js pages (main app, API routes, globals) |
| `platform/src/components/ui/` | 48 shadcn/ui components (buttons, cards, dialogs, etc.) |
| `platform/src/hooks/` | React hooks (use-mobile, use-toast) |
| `platform/src/lib/` | Utilities (db.ts, utils.ts) |
| `platform/prisma/schema.prisma` | Database schema (customers, jobs, techs, quotes) |
| `platform/db/custom.db` | SQLite database with real data |
| `platform/output/` | Assembly tech code generation (HTML + PDF + Python) |
| `platform/scripts/` | Build/dev/deploy scripts |
| `platform/public/` | Static assets (logo, robots.txt) |
| `platform/package.json` | Next.js dependencies |
| `platform/next.config.ts` | Next.js config |
| `platform/tsconfig.json` | TypeScript config |
| `platform/tailwind.config.ts` | Tailwind CSS config |
| `platform/Caddyfile` | Reverse proxy config |

### ❌ TRASH (deleted with repo — 470 files across 47 skill directories)

Generic skills not relevant to AVA007 or Help Assembly:
ai-news-collectors, aminer-*, anti-pua, auto-target-tracker, blog-writer,
cheat-sheet, content-strategy, contentanalysis, docx, dream-interpreter,
finance, fullstack-dev, get-fortune-analysis, gift-evaluator,
interview-*, jd-resume-tailor, job-intent-tracker, market-research-reports,
marketing-mode, mindfulness-meditation, multi-search-engine, pdf,
podcast-generate, ppt (75 files!), qingyan-research, quiz-*, resume-builder,
seo-content-writer, skill-creator, skill-finder-cn, skill-vetter,
stock-analysis-skill, storyboard-manager, study-buddy, task-review,
ui-ux-pro-max (56 files!), video-generation, visual-design-foundations,
web-shader-extractor, writing-plans, xlsx, agent-browser

---

## Wiring: MemBrain → Ava007 + Agent-X

```
┌─────────────────────────────────────────────────────────────────┐
│                    QAG-MEMBRAIN (MemBrain)                      │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Rev.Ike    │  │   GSAP       │  │  Context Ocean       │  │
│  │  (Subconscious)│ │  Temporal    │  │  (DuckDB + Iceberg)  │  │
│  │              │  │  Engine      │  │                      │  │
│  │ ASR (hearing)│  │              │  │  Receipts → Parquet  │  │
│  │ VLM (vision) │  │ insertIntel()│  │  Tashi DAG consensus │  │
│  │ LLM (cog)    │  │ recallState()│  │  GraphRAG (Neo4j)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                     │              │
│  ┌──────┴─────────────────┴─────────────────────┴───────────┐  │
│  │              ZAI SDK Skills (12 abilities)                │  │
│  │  ASR · LLM · TTS · VLM · web-search · web-reader         │  │
│  │  image-understand · image-generation · image-edit         │  │
│  │  video-understand · charts · coding-agent                 │  │
│  └──────┬──────────────────────────────────┬────────────────┘  │
│         │                                  │                   │
└─────────┼──────────────────────────────────┼───────────────────┘
          │                                  │
          ▼ WIRED                            ▼ WIRED
┌─────────────────────┐            ┌─────────────────────────────┐
│   AVA007 MODEL      │            │      AGENT-X MODEL          │
│   (Cybernetic       │            │   (Help Assembly Services)  │
│    Persistent Model)│            │                             │
│                     │            │  platform/src/ (Next.js)    │
│  SuperLoop          │            │  prisma/ (database)         │
│  ava-brain.ts       │            │  patterns.py (22 business)  │
│  temporal-substrate │            │  harness.py (zero-latency)  │
│  voice/speak.ts     │            │  mercury_engine.py          │
│  constellation      │            │  skill_arena.py             │
│  meta_harness       │            │  reflex_router.py           │
│  lite_notebook      │            │                             │
│  harness registry   │            │  BUSINESS_PHONE=+14044391350│
└─────────────────────┘            └─────────────────────────────┘
```

### Connection points:
1. **MemBrain → Ava007**: Rev.Ike (ASR/VLM/LLM) feeds perceptions → Receipts → Context Ocean → Ava007 SuperLoop processes
2. **MemBrain → Agent-X**: web-search/web-reader/charts skills → Agent-X harness calls them via Goose dispatch
3. **Ava007 → Agent-X**: Ava007 routes business queries to Agent-X's pattern library (22 patterns) + Mercury2 engine
4. **Agent-X → Ava007**: Agent-X deposits Receipts back to Context Ocean via Ava007's LiteNotebook::deposit()
5. **GSAP Timeline**: Records every interaction across all three — the audit layer

---

## Post-Consolidation Repo State

| Repo | Branch | What's There | Status |
|------|--------|-------------|--------|
| **QAG-MemBrain** | main | 13 Rust crates + ZAI SDK skills + GSAP temporal + voice + telecom + DLI + Goose+DoubleQ | ✅ Active |
| **QAG-MemBrain** | mobile-runtime | Mobile Capacitor app + ProductRenderer + Builder.io | ✅ Active |
| **Agent-X** | main | Zero-latency harness + Mercury2 + 22 patterns + Help Assembly platform | ✅ Active |
| **Ava007** | main | Original platform (18K lines TS) — superLoop, ava-brain, temporal-substrate | ✅ Active (source of truth) |
| **ava007-membrain** | main | **TO BE DELETED** — all useful files moved out | ❌ Ready for deletion |
