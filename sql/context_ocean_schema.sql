-- ============================================================================
-- AVA007 — Context Ocean DuckDB Schema
-- ============================================================================
-- Target:    DuckDB-WASM 1.1+ (runs in EPOCH ArrowJS sandbox on s25runtime)
-- Source:    Parquet files written by lite_notebook::iceberg_writer
-- Schema:    One Iceberg table = one DuckDB view over Parquet files
--
-- Loading:
--   -- Auto-detect schema from the latest Iceberg metadata:
--   CREATE TABLE receipts AS
--   SELECT * FROM read_parquet('/data/local/tmp/ava007/context_ocean/data/*.parquet');
--
--   -- Or use the Iceberg metadata pointer (preferred — only sees committed snapshots):
--   CALL iceberg_scan('/data/local/tmp/ava007/context_ocean/metadata/latest.json');
--
-- All Receipt columns are NOT NULL except where explicitly nullable.
-- Column order matches receipt::receipt_schema() in lite_notebook/src/receipt.rs.
-- ============================================================================

-- ── 1. CORE TABLE ────────────────────────────────────────────────────────────
-- The atomic Receipt table. Every perception, cognition, action, memory,
-- and control event in AVA007 lives here exactly once.

CREATE TABLE IF NOT EXISTS receipts (
    id              BLOB           NOT NULL,        -- UUIDv7, 16 bytes BE
    timestamp_ns    BIGINT         NOT NULL,        -- nanoseconds since UNIX_EPOCH
    session_id      VARCHAR        NOT NULL,
    origin          VARCHAR        NOT NULL CHECK (origin IN
                        ('REV.IKE','FABLE','GOOSE','TASHI','EPOCH','USER')),
    kind            VARCHAR        NOT NULL CHECK (kind IN
                        ('perception','cognition','action','memory','control')),
    content_hash    BLOB           NOT NULL,        -- SHA-256, 32 bytes
    content         VARCHAR        NOT NULL,
    embedding       FLOAT[]        ,                -- nullable; 384 or 768-dim
    parent_receipt  BLOB           ,                -- nullable UUIDv7 (DAG lineage)
    trust_score     FLOAT          NOT NULL DEFAULT 0.5,
    knox_safe       BOOLEAN        NOT NULL DEFAULT TRUE,
    metadata        JSON           NOT NULL DEFAULT '{}'::JSON
);

-- Primary key — UUID is globally unique
ALTER TABLE receipts ADD CONSTRAINT receipts_pk PRIMARY KEY (id);

-- ── 2. INDEXES ───────────────────────────────────────────────────────────────
-- DuckDB indexes are zone-maps / ART indexes. They accelerate point lookups
-- and range scans. For analytical scans, DuckDB's vectorized engine is
-- already fast without indexes — these are for OLTP-style queries.

-- Time range (most common: "give me receipts from the last hour")
CREATE INDEX IF NOT EXISTS idx_receipts_ts        ON receipts (timestamp_ns);

-- Session drill-down (Open Notebook LM session view)
CREATE INDEX IF NOT EXISTS idx_receipts_session   ON receipts (session_id, timestamp_ns);

-- Origin + kind filter (Constellation routing introspection)
CREATE INDEX IF NOT EXISTS idx_receipts_origin    ON receipts (origin, kind);

-- Lineage traversal (parent → children lookups)
CREATE INDEX IF NOT EXISTS idx_receipts_parent    ON receipts (parent_receipt);

-- Content-addressed lookup (dedup, integrity check)
CREATE INDEX IF NOT EXISTS idx_receipts_hash      ON receipts (content_hash);

-- Knox-safety filter (fast scans for unsafe receipts during audit)
CREATE INDEX IF NOT EXISTS idx_receipts_knox      ON receipts (knox_safe) WHERE knox_safe = FALSE;

-- ── 3. CONVENIENCE VIEWS ─────────────────────────────────────────────────────

-- Human-readable timestamps + decoded UUIDs.
-- Use this for UI rendering, NOT for analytical queries (it's a projection).
CREATE OR REPLACE VIEW receipts_readable AS
SELECT
    id,
    epoch(timestamp_ns / 1_000_000_000)                 AS timestamp_utc,
    timestamp_ns,
    session_id,
    origin,
    kind,
    encode(content_hash, 'hex')                         AS content_hash_hex,
    content,
    embedding,
    parent_receipt,
    trust_score,
    knox_safe,
    metadata
FROM receipts;

-- ── 4. LINEAGE VIEW (RECURSIVE CTE) ─────────────────────────────────────────
-- Walks the parent_receipt DAG from any receipt up to its root perception.
-- Used by REV.IKE for "how did I arrive at this conclusion?" introspection,
-- and by the UI for rendering conversation/thread trees.
--
-- Example:
--   SELECT * FROM receipt_lineage WHERE root_id = ?
--   ORDER BY depth, timestamp_ns;

CREATE OR REPLACE VIEW receipt_lineage AS
WITH RECURSIVE lineage AS (
    -- Base case: roots (perceptions with no parent)
    SELECT
        id              AS node_id,
        parent_receipt  AS parent_id,
        id              AS root_id,
        0               AS depth,
        timestamp_ns,
        session_id,
        origin,
        kind,
        content
    FROM receipts
    WHERE parent_receipt IS NULL

    UNION ALL

    -- Recursive step: children of any node we've seen
    SELECT
        r.id            AS node_id,
        r.parent_receipt AS parent_id,
        l.root_id,
        l.depth + 1     AS depth,
        r.timestamp_ns,
        r.session_id,
        r.origin,
        r.kind,
        r.content
    FROM receipts r
    JOIN lineage l ON r.parent_receipt = l.node_id
)
SELECT * FROM lineage;

-- Reverse: walk DOWN from any receipt to all descendants.
CREATE OR REPLACE VIEW receipt_descendants AS
WITH RECURSIVE descendants AS (
    SELECT
        id              AS node_id,
        id              AS root_id,
        0               AS depth,
        timestamp_ns,
        session_id,
        origin,
        kind,
        content
    FROM receipts

    UNION ALL

    SELECT
        r.id            AS node_id,
        d.root_id,
        d.depth + 1     AS depth,
        r.timestamp_ns,
        r.session_id,
        r.origin,
        r.kind,
        r.content
    FROM receipts r
    JOIN descendants d ON r.parent_receipt = d.node_id
)
SELECT * FROM descendants;

-- ── 5. SESSION TIMELINE VIEW ────────────────────────────────────────────────
-- Per-session summary + recent activity. The "Open Notebook" UI lands here.

CREATE OR REPLACE VIEW session_timelines AS
SELECT
    session_id,
    COUNT(*)                                       AS receipt_count,
    MIN(timestamp_ns)                             AS first_ns,
    MAX(timestamp_ns)                             AS last_ns,
    (MAX(timestamp_ns) - MIN(timestamp_ns)) / 1e9 AS duration_seconds,
    COUNT(DISTINCT origin)                        AS distinct_origins,
    COUNT(DISTINCT kind)                          AS distinct_kinds,
    AVG(trust_score)                              AS avg_trust,
    MIN(trust_score)                              AS min_trust,
    SUM(CASE WHEN knox_safe = FALSE THEN 1 ELSE 0 END) AS unsafe_count,
    -- Last 5 receipts as a JSON array (for UI preview)
    list({
        id: id,
        origin: origin,
        kind: kind,
        content: content,
        ts: timestamp_ns
    } ORDER BY timestamp_ns DESC)[1:5]            AS recent_receipts
FROM receipts
GROUP BY session_id
ORDER BY last_ns DESC;

-- ── 6. ORIGIN / KIND AGGREGATES (Constellation introspection) ───────────────

CREATE OR REPLACE VIEW origin_stats AS
SELECT
    origin,
    kind,
    COUNT(*)                                       AS count,
    AVG(trust_score)                              AS avg_trust,
    MIN(timestamp_ns)                             AS first_seen_ns,
    MAX(timestamp_ns)                             AS last_seen_ns,
    AVG(length(content))                          AS avg_content_len,
    COUNTIF(embedding IS NOT NULL)                AS embedded_count
FROM receipts
GROUP BY origin, kind
ORDER BY origin, count DESC;

-- ── 7. SIMILARITY SEARCH (VSS EXTENSION) ────────────────────────────────────
-- Requires DuckDB VSS extension (loaded automatically by DuckDB-WASM 1.1+).
-- Used by Open Notebook LM for "find similar thoughts" and by FABLE for
-- few-shot retrieval before planning.
--
-- The index is HNSW (Hierarchical Navigable Small World) — sub-millisecond
-- recall on 100k+ vectors at 384-dim on the Snapdragon 8 Elite NPU via NNAPI.

INSTALL vss;
LOAD vss;

-- Embeddings are stored as FLOAT[] in the receipts table. VSS works on
-- FLOAT[N] fixed-shape arrays. We create a typed shadow column.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS embedding_f32 FLOAT[384];

UPDATE receipts
SET embedding_f32 = embedding::FLOAT[384]
WHERE embedding IS NOT NULL
  AND array_length(embedding) = 384;

-- HNSW index — cosine distance (best for normalized embeddings)
CREATE INDEX IF NOT EXISTS idx_receipts_embedding_hnsw
ON receipts USING HNSW (embedding_f32)
WITH (
    metric = 'cosine',
    m = 16,
    ef_construction = 64,
    ef_search = 32
);

-- Similarity-search function — callable from Open Notebook LM
CREATE OR REPLACE MACRO recall_similar(query_emb FLOAT[384], k INTEGER := 10)
AS TABLE
SELECT
    id,
    session_id,
    origin,
    kind,
    content,
    trust_score,
    array_cosine_distance(embedding_f32, query_emb) AS distance,
    1 - array_cosine_distance(embedding_f32, query_emb) AS similarity
FROM receipts
WHERE embedding_f32 IS NOT NULL
ORDER BY array_cosine_distance(embedding_f32, query_emb) ASC
LIMIT k;

-- ── 8. REV.IKE INTERPRETATION CHANNEL (READ-ONLY) ───────────────────────────
-- REV.IKE is the subconscious. It never writes Receipts with kind=Action.
-- This view exposes the live interpretation feed it consumes.

CREATE OR REPLACE VIEW revike_interpretation_feed AS
SELECT
    id,
    timestamp_ns,
    session_id,
    origin,
    kind,
    content,
    trust_score,
    parent_receipt,
    -- Predicted next-agent routing (heuristic, can be overridden by FABLE)
    CASE
        WHEN kind = 'perception' AND trust_score >= 0.8 THEN 'FABLE'
        WHEN kind = 'perception'                        THEN 'REV.IKE'
        WHEN kind = 'cognition' AND content LIKE '%plan%'  THEN 'GOOSE'
        WHEN kind = 'cognition'                         THEN 'EPOCH'
        WHEN kind = 'memory'                            THEN 'TASHI'
        ELSE 'EPOCH'
    END AS predicted_route
FROM receipts
WHERE knox_safe = TRUE
ORDER BY timestamp_ns DESC
LIMIT 256;

-- ── 9. AUDIT / KNOX SAFETY VIEW ─────────────────────────────────────────────
-- Lists every Receipt that touched Knox-sensitive surfaces.
-- The user can audit this view at any time. Empty = Knox intact.

CREATE OR REPLACE VIEW knox_audit_log AS
SELECT
    id,
    epoch(timestamp_ns / 1_000_000_000) AS timestamp_utc,
    session_id,
    origin,
    kind,
    content,
    metadata->>'$.action'   AS action,
    metadata->>'$.surface'  AS surface,
    metadata->>'$.reason'   AS reason
FROM receipts
WHERE knox_safe = FALSE
ORDER BY timestamp_ns DESC;

-- ── 10. TASHI MEMORY COMPACTION TARGET ──────────────────────────────────────
-- Identifies sessions whose receipts exceed the L2 memory budget (default
-- 1MB of content). TASHI compacts these into a single Memory Receipt
-- whose content is a summary embedding + LLM-generated gist.

CREATE OR REPLACE VIEW tashi_compaction_candidates AS
SELECT
    session_id,
    COUNT(*)                                  AS receipt_count,
    SUM(length(content))                      AS total_content_bytes,
    AVG(trust_score)                          AS avg_trust,
    MIN(timestamp_ns)                         AS first_ns,
    MAX(timestamp_ns)                         AS last_ns
FROM receipts
GROUP BY session_id
HAVING SUM(length(content)) > 1_000_000  -- 1MB threshold
ORDER BY total_content_bytes DESC;

-- ── 11. OPEN NOTEBOOK LM — PUBLIC QUERY SURFACE ─────────────────────────────
-- These are the only macros Open Notebook LM is allowed to call.
-- They form the API between the human-readable notebook UI and the
-- Context Ocean. Everything else is internal.

-- Search by natural-language query (uses FTS5 + VSS hybrid)
CREATE OR REPLACE MACRO notebook_search(
    query_text VARCHAR,
    query_emb FLOAT[384] := NULL,
    k INTEGER := 10
) AS TABLE
WITH fts_hits AS (
    SELECT
        r.id,
        r.timestamp_ns,
        r.session_id,
        r.origin,
        r.kind,
        r.content,
        r.trust_score,
        fts_match.content_score
    FROM receipts r
    JOIN (
        SELECT id, bm25(receipts_fts) AS content_score
        FROM receipts_fts
        WHERE receipts_fts MATCH query_text
        ORDER BY content_score DESC
        LIMIT k * 2
    ) fts_match ON r.id = fts_match.id
),
vss_hits AS (
    SELECT
        id,
        timestamp_ns,
        session_id,
        origin,
        kind,
        content,
        trust_score,
        1.0 AS content_score
    FROM recall_similar(query_emb, k * 2)
    WHERE query_emb IS NOT NULL
),
combined AS (
    SELECT * FROM fts_hits
    UNION ALL
    SELECT * FROM vss_hits
)
SELECT
    id,
    timestamp_ns,
    session_id,
    origin,
    kind,
    content,
    trust_score,
    MAX(content_score) AS relevance
FROM combined
GROUP BY id, timestamp_ns, session_id, origin, kind, content, trust_score
ORDER BY relevance DESC
LIMIT k;

-- Full-text search index (DuckDB FTS extension)
INSTALL fts;
LOAD fts;

CREATE VIRTUAL TABLE IF NOT EXISTS receipts_fts USING fts (
    content,
    content_hash,
    session_id,
    origin,
    kind,
    tokenize = 'unicode'
);

-- Refresh FTS index (call after every Iceberg commit)
-- In practice this is auto-triggered by the deposit_loop post-commit hook.
-- PRAGMA fts_deactivate('receipts_fts');  -- if you need to rebuild
-- PRAGMA fts_activate('receipts_fts');

-- ── 12. ICEBERG SNAPSHOT TRACKING ───────────────────────────────────────────
-- Mirrors the Iceberg table metadata so DuckDB can answer
-- "what's the latest committed snapshot?" without scanning Parquet headers.

CREATE TABLE IF NOT EXISTS iceberg_snapshots (
    snapshot_id          BLOB     NOT NULL PRIMARY KEY,
    parent_snapshot_id   BLOB     ,
    timestamp_ms         BIGINT   NOT NULL,
    manifest_list_path   VARCHAR  NOT NULL,
    added_data_files     INTEGER  NOT NULL,
    added_records        BIGINT   NOT NULL,
    total_data_files     INTEGER  NOT NULL,
    total_records        BIGINT   NOT NULL,
    added_bytes          BIGINT   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_ts
ON iceberg_snapshots (timestamp_ms DESC);

-- The "current pointer" — single-row table.
CREATE TABLE IF NOT EXISTS iceberg_current (
    singleton       BOOLEAN NOT NULL DEFAULT TRUE PRIMARY KEY,
    current_snapshot_id BLOB NOT NULL
);

INSERT OR IGNORE INTO iceberg_current VALUES (TRUE, NULL);

-- ── 13. HELPER FUNCTIONS ────────────────────────────────────────────────────

-- UUID pretty-print (BLOB → canonical string)
CREATE OR REPLACE MACRO uuid_str(b BLOB) AS
    format('{:08x}-{:04x}-{:04x}-{:04x}-{:012x}',
        CAST(extract(b, 1, 4) AS UINTEGER),
        CAST(extract(b, 5, 2) AS USMALLINT),
        CAST(extract(b, 7, 2) AS USMALLINT),
        CAST(extract(b, 9, 2) AS USMALLINT),
        CAST(extract(b, 11, 6) AS UBIGINT)
    );

-- Receipt age in seconds (for UI "5m ago" labels)
CREATE OR REPLACE MACRO receipt_age_seconds(ts_ns BIGINT) AS
    (CAST(extract(epoch FROM now()) AS BIGINT) * 1_000_000_000 - ts_ns) / 1e9;

-- ── 14. GRANTS (s25runtime permissions) ─────────────────────────────────────
-- Open Notebook LM (read-write on its own views, read on core table)
-- REV.IKE  (read-only on core table + lineage views)
-- EPOCH    (read-only on receipts_readable + session_timelines)
-- AVA007   (full access — the executive loop)

-- DuckDB-WASM doesn't enforce GRANT/REVOKE at the WASM boundary (the host
-- process owns all access). These are documentation of intent:
-- GRANT  SELECT ON receipts               TO revike, epoch;
-- GRANT  SELECT ON receipts_readable      TO revike, epoch;
-- GRANT  SELECT ON session_timelines      TO revike, epoch;
-- GRANT  SELECT ON receipt_lineage        TO revike;
-- GRANT  SELECT ON receipt_descendants    TO revike;
-- GRANT  SELECT ON revike_interpretation_feed TO revike;
-- GRANT  SELECT, INSERT, UPDATE ON receipts   TO ava007, tashi;
-- GRANT  SELECT, INSERT ON iceberg_snapshots  TO ava007;
-- GRANT  UPDATE ON iceberg_current            TO ava007;
-- GRANT  SELECT ON knox_audit_log             TO user;  -- the human

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
-- To regenerate after a Receipt schema change:
--   1. Bump the version in lite_notebook/src/receipt.rs (add a Field).
--   2. Add a migration below using ALTER TABLE ... ADD COLUMN.
--   3. Bump this version number:
-- ============================================================================

-- SCHEMA_VERSION: 1
-- LAST_MIGRATION: 2026-06-27T00:00:00Z
