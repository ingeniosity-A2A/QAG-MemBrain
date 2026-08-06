# Substrate Parallelism: DuckDB → Parquet/Iceberg + ADBC → Arrow Flight RPC

> **Status:** Evidence-backed synthesis, not a benchmark proposal.
> **Date:** 2026-08-06
> **Provenance:** Live DuckDB→Flight measurements, Hopsworks production case study, TU Delft paper, DuckDB issue #3099, DuckDB-Wasm maintainer discussion.

---

## The Pipeline

```
DuckDB (entry) → Parquet/Iceberg + ADBC (middle) → Arrow Flight RPC (outlet)
```

### Entry — DuckDB

DuckDB is the query/compute engine and the right entry point because it natively speaks Arrow at its execution core — not bolting Arrow support on afterward. Confirmed by both the DeepWiki source description (`fetch_arrow_table()`/`register()` operating on shared buffers) and live testing (`fetch_record_batch()` handing back Arrow batches straight from query execution, no Python object layer in between).

DuckDB is where SQL, filtering, joins, and aggregation happen — the cognitive-adjacent work in the exoskeleton framing.

**Key property:** Zero-copy Arrow integration at the execution core. Query results materialize directly as Arrow batches without an intermediate Python/object layer.

### Middle — Parquet/Iceberg + ADBC

This layer decides *what DuckDB is querying* and *how other systems can reach the same data without a custom driver per source*. It splits into two distinct, compositional jobs:

#### Parquet/Iceberg — Storage Format Layer

Parquet is already columnar on disk. DuckDB's Parquet reader does projection pushdown straight into Arrow buffers — no format conversion, just reading a columnar file into a columnar in-memory structure shaped the same way.

Iceberg (and Delta Lake) sit on top of Parquet and add table-level concerns:
- Partitioning
- Snapshots
- Schema evolution
- ACID transactions

All still bottom out in Parquet files DuckDB can scan identically. DuckDB has a maintained `iceberg` extension for exactly this.

**In the exoskeleton architecture, this is where the persistent memory bank belongs:** Parquet/Iceberg as the durable substrate, DuckDB as the query surface over it.

#### ADBC — Driver Unification Layer

ADBC (Arrow Database Connectivity) matters because it keeps the stack from needing a bespoke connector for every capability source. Unlike JDBC/ODBC (where every driver returns row-oriented results that must be transposed to columnar), ADBC drivers hand back Arrow arrays directly — for Postgres, BigQuery, Snowflake, and critically, for any Flight SQL server via the meta-driver.

**The load-bearing architectural point:** An ADBC-based capability doesn't need to know it's ultimately talking to Flight. The same client code that queries a local DuckDB table can, via the FlightSQL ADBC driver, query a remote Flight SQL server with **zero code change**.

**Why they compose rather than fork:** Iceberg/Parquet is what's *stored*. ADBC is *how anything queries it uniformly*. They are orthogonal layers addressing different concerns.

### Outlet — Arrow Flight RPC

Flight's job is narrow and correct for a substrate: it moves Arrow buffers that DuckDB/Parquet/ADBC already produced, across a process or network boundary, without re-encoding them. It does not touch the data's meaning.

**Evidence (measured, not theoretical):**

| Source | Measured Speedup | Context |
|--------|-----------------|---------|
| Live pipeline (this project) | 1.5× – 20.7× | Scaling with row count, DuckDB → Flight |
| Hopsworks production | 45× | Flight vs alternative transport |
| TU Delft paper | 30× | Flight vs ODBC |
| DuckDB issue #3099 | Acknowledged fit | Maintainers confirm architectural alignment |

---

## Mapping to the Exoskeleton Three-Layer Model

```
┌─────────────────────────────────────────────────────┐
│  INTELLECT (Layer 3)                                │
│  Issues queries, reasons about intent               │
│  Consumes Arrow — doesn't care how it arrived      │
├─────────────────────────────────────────────────────┤
│  Arrow Flight RPC (wire)                           │
│  Moves Arrow buffers across process/network        │
│  No re-encoding. No format-translation tax.        │
├─────────────────────────────────────────────────────┤
│  SUBSTRATE (Layer 2)                                │
│  DuckDB + Parquet/Iceberg + ADBC                    │
│  Store, query, move columnar data uniformly        │
│  No reasoning about task intent — just data        │
├─────────────────────────────────────────────────────┤
│  CAPABILITIES (Layer 1)                             │
│  Individual skills, tools, sensors                 │
│  Produce/consume via Arrow or ADBC                 │
└─────────────────────────────────────────────────────┘
```

DuckDB + Parquet/Iceberg + ADBC together *are* Layer 2. None of them reason about task intent — they store, query, and move columnar data uniformly. Arrow Flight is the wire connecting Layer 2 to whatever sits above (Intellect issuing the query) and below (a Capability being invoked).

**The theory holds because every piece in the middle already agrees on the same in-memory format.** That's the actual mechanism behind "the substrate doesn't burden the model": there's no format-translation tax anywhere in this chain until data needs to leave the process, and even then Flight minimizes it rather than reintroducing it.

---

## Critical Limitation: DuckDB-Wasm Does Not Support Arrow Flight

> **Severity:** Architecture-breaking for browser/edge tiers.
> **Source:** DuckDB-Wasm maintainer GitHub discussion (direct quote: "Arrow Flight is not supported.")

### The Structural Reason

Arrow Flight is built on gRPC. gRPC's wire protocol (HTTP/2 trailers, specific framing) is not something a browser can speak directly. Browsers cannot originate raw gRPC calls. You need **gRPC-Web**, a translation shim, between the browser and a real gRPC/Flight server, usually via an Envoy proxy or purpose-built bridge.

There is no native, first-party bridge from the Arrow ecosystem that does this for Flight specifically. Evidence: someone building exactly this gap by hand (custom Go Flight server + gRPC-Web frontend, two separate repos) — this is a "build it yourself" situation, not a supported pattern.

### What People Are Actually Doing Instead

1. **Send Arrow IPC or Parquet bytes over regular HTTP** (not Flight/gRPC) into DuckDB-Wasm, which reads them natively once in the browser. Maintainer suggestion: have a server-side DuckDB do the heavy lifting, export Arrow IPC or DuckDB's native storage format, ship over plain HTTP for DuckDB-Wasm to open client-side.

2. **gRPC-Web proxy approach** — an independent project is doing real gRPC-Web + Flight client work in TypeScript, getting a 134MB dataset into browser memory in ~1.6s. The transport is achievable, but you're building a custom Flight-aware client layer in the browser and handing DuckDB-Wasm the resulting Arrow buffers afterward.

### Arrow IPC Expansion Caveat

A real reported case: 150MB CSV → ~2GB in Arrow IPC format. This is an unusually bad expansion ratio, almost certainly caused by a schema/type mismatch (everything boxed as wide/nullable type, dictionary encoding not used) rather than something inherent to IPC. But it's a real reported number, not theoretical — "just export Arrow IPC" isn't automatically safe without checking the export schema.

### Architectural Implication

```
┌──────────────────────────────────────────────────────┐
│  Server-to-Server / Server-to-Desktop               │
│                                                      │
│  DuckDB ──→ Parquet/Iceberg ──→ ADBC ──→ Flight RPC  │
│                                              ✓       │
│  Full pipeline works as designed.                   │
├──────────────────────────────────────────────────────┤
│  Server-to-Browser (DuckDB-Wasm edge/reflex tier)   │
│                                                      │
│  Option A: gRPC-Web proxy + hand-rolled Flight      │
│             client → DuckDB-Wasm (build it yourself) │
│                                                      │
│  Option B: Server DuckDB exports Arrow IPC/Parquet  │
│             over plain HTTP → DuckDB-Wasm           │
│             (simpler, proven, lose Flight semantics) │
└──────────────────────────────────────────────────────┘
```

**Recommendation for browser-facing tiers:** Option B is the lower-risk choice. Drop Flight for the browser hop specifically — have the nearest server-side DuckDB instance export Arrow IPC or Parquet over plain HTTP, let DuckDB-Wasm consume that natively. Reserve Flight for the server-to-server hops where it's proven.

---

## Evidence Inventory

| Claim | Evidence Type | Source |
|-------|--------------|--------|
| DuckDB Arrow-native execution core | Code inspection + docs | DeepWiki, DuckDB docs |
| `fetch_record_batch()` zero-copy | Live test | This project |
| Flight speedup 1.5×–20.7× | Live benchmark | This project |
| Flight speedup 45× | Production case study | Hopsworks |
| Flight speedup 30× vs ODBC | Peer-reviewed paper | TU Delft |
| DuckDB maintainers confirm Flight fit | GitHub issue #3099 | DuckDB repo |
| DuckDB Iceberg extension exists | Maintained extension | DuckDB repo |
| ADBC zero-code-change Flight SQL | ADBC driver model | Arrow ADBC docs |
| DuckDB-Wasm no Flight support | Maintainer statement | GitHub discussion |
| gRPC unavailable in browsers | Web platform spec | W3C/WHATWG |
| Arrow IPC 150MB→2GB expansion | User report | DuckDB-Wasm discussion |
| gRPC-Web Flight 134MB in 1.6s | Independent project | GitHub (TS Flight client) |

---

## Confidence Levels

- **High confidence (measured):** DuckDB Arrow-native core, Flight speedups, DuckDB-Wasm no Flight
- **Medium confidence (architecturally sound, not yet run):** Iceberg-as-memory-bank, ADBC FlightSQL meta-driver with zero code change
- **Low confidence (theoretical):** gRPC-Web bridge for Flight in production browser context
