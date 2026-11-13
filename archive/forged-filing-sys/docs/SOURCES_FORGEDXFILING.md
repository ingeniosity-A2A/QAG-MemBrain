# FORGEDXFILING architecture sources

Six PDFs form the reconciled design base. Implement **one** system; do not spin six parallel projects.

| # | Document | FORGEDXFILING layer |
|---|----------|---------------------|
| 1 | The Rev.ike Zero-Copy Streaming Architecture | Zero-copy streaming (Rev.Ike) |
| 2 | Rev.ike Zero-Copy Streaming Benchmark and Engineering Report | Benchmarks / performance contracts |
| 3 | Sovereign Ingestion and Streamed Exploration Protocol | Ingestion + exploration protocol |
| 4 | The Exoskeleton Framework — Substrate Architecture and Gateway Elimination | Boundary with A2A-Exoskeleton |
| 5 | Bento UI8 Pluggable Architecture — Aetheris Memory Timeline Explorer | Bento UI8 + Aetheris |
| 6 | Building a Scroll-Driven 3D Interactive Memory Timeline | Aetheris timeline interaction |

**Binary packs:** place under `docs/sources/` (prefer Git LFS for large PDFs).

```bash
git lfs track "docs/sources/**/*.PDF"
```

Canonical product doc: [FORGEDXFILING.md](FORGEDXFILING.md)
