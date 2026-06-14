// ═══════════════════════════════════════════════════════════════════
// QUANTUM ATOMIC GSAP MEMBRAiN — Layer 3: Neo4j Graph + Vector
// Graph traversal (DAG ancestry) + vector similarity in one query.
// No pgvector. No separate vector DB. Neo4j handles both.
//
// Node types:  (:Memory) (:Vertex) (:Timeline) (:Policy)
// Rel types:   [:PRECEDES] [:INFLUENCED] [:PART_OF] [:PARENT_OF]
// ═══════════════════════════════════════════════════════════════════

import neo4j, { Driver, Session } from "neo4j-driver";
import { AtomicMemory, TashiVertex, TimelineDefinition, Neo4jMemoryNode } from "../../shared/types.js";

// ─── Schema (run once on first start) ────────────────────────────────
export const SCHEMA_CYPHER = `
// Node constraints
CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT vertex_hash IF NOT EXISTS FOR (v:Vertex) REQUIRE v.hash IS UNIQUE;
CREATE CONSTRAINT timeline_id IF NOT EXISTS FOR (t:Timeline) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT policy_id IF NOT EXISTS FOR (p:Policy) REQUIRE p.id IS UNIQUE;

// Standard property indexes
CREATE INDEX memory_timestamp IF NOT EXISTS FOR (m:Memory) ON (m.timestamp);
CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.type);
CREATE INDEX memory_importance IF NOT EXISTS FOR (m:Memory) ON (m.importance);

// Vector index — 1536-dim cosine similarity (OpenAI / compatible embeddings)
CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
  FOR (m:Memory) ON (m.embedding)
  OPTIONS { indexConfig: { 'vector.dimensions': 1536, 'vector.similarity_function': 'cosine' } };
`;

// ─── Neo4j Client ─────────────────────────────────────────────────────
export class MemBrainGraph {
  private driver: Driver;

  constructor(url: string, user: string, password: string) {
    this.driver = neo4j.driver(url, neo4j.auth.basic(user, password));
  }

  private session(): Session {
    return this.driver.session();
  }

  // ── Schema init ──────────────────────────────────────────────────
  async initSchema(): Promise<void> {
    const s = this.session();
    try {
      for (const stmt of SCHEMA_CYPHER.split(";").filter(l => l.trim())) {
        await s.run(stmt);
      }
    } finally { await s.close(); }
  }

  // ── Write: AtomicMemory → (:Memory) node ─────────────────────────
  async writeAtom(atom: AtomicMemory): Promise<void> {
    const s = this.session();
    try {
      await s.run(
        `MERGE (m:Memory { id: $id })
         SET m += {
           type:        $type,
           source:      $source,
           timestamp:   $timestamp,
           title:       $title,
           content:     $content,
           tags:        $tags,
           importance:  $importance,
           confidence:  $confidence,
           vertex_hash: $vertex_hash,
           embedding:   $embedding
         }`,
        {
          id:          atom.id,
          type:        atom.type,
          source:      atom.source,
          timestamp:   atom.timestamp,
          title:       atom.title,
          content:     atom.content,
          tags:        atom.tags,
          importance:  atom.metadata.importance,
          confidence:  atom.metadata.confidence,
          vertex_hash: atom.vertex_hash ?? "",
          embedding:   atom.embedding,
        }
      );
    } finally { await s.close(); }
  }

  // ── Write: TashiVertex → (:Vertex) + [:PARENT_OF] rels ───────────
  async writeVertex(vertex: TashiVertex): Promise<void> {
    const s = this.session();
    try {
      // Create vertex node and link to its Memory atom
      await s.run(
        `MERGE (v:Vertex { hash: $hash })
         SET v += { creator: $creator, created_at: $created_at, signature: $signature }
         WITH v
         MATCH (m:Memory { id: $atom_id })
         MERGE (v)-[:CONTAINS]->(m)`,
        {
          hash:       vertex.hash,
          creator:    vertex.creator,
          created_at: vertex.created_at,
          signature:  vertex.signature,
          atom_id:    vertex.data.id,
        }
      );

      // Create [:PARENT_OF] edges for DAG structure
      for (const parentHash of vertex.parents) {
        await s.run(
          `MATCH (parent:Vertex { hash: $parentHash })
           MATCH (child:Vertex  { hash: $childHash  })
           MERGE (parent)-[:PARENT_OF]->(child)`,
          { parentHash, childHash: vertex.hash }
        );
      }

      // Create temporal ordering between Memory nodes
      if (vertex.parents.length > 0) {
        await s.run(
          `MATCH (parent:Vertex { hash: $parentHash })-[:CONTAINS]->(parentMem:Memory)
           MATCH (child:Vertex  { hash: $childHash  })-[:CONTAINS]->(childMem:Memory)
           MERGE (parentMem)-[:PRECEDES]->(childMem)`,
          { parentHash: vertex.parents[0], childHash: vertex.hash }
        );
      }
    } finally { await s.close(); }
  }

  // ── GraphRAG: semantic similarity + graph context in one query ────
  // The key query that makes Neo4j worth it over pgvector.
  // Finds atoms that are semantically similar AND connected via DAG.
  async graphRagSearch(
    queryEmbedding: number[],
    anchorAtomId:   string,
    k:              number = 10,
    dagHops:        number = 3,
  ): Promise<Array<{ atom: Neo4jMemoryNode; score: number; hops: number }>> {
    const s = this.session();
    try {
      const result = await s.run(
        `CALL db.index.vector.queryNodes('memory_embedding', $k, $embedding)
         YIELD node AS m, score
         OPTIONAL MATCH path = (anchor:Memory { id: $anchorId })-[:PRECEDES*1..$hops]->(m)
         WITH m, score,
              CASE WHEN path IS NULL THEN 999 ELSE length(path) END AS hops
         WHERE m.importance IN ['high', 'critical'] OR score > 0.75
         RETURN m {
           .id, .type, .timestamp, .content, .importance, .confidence,
           .vertex_hash, .embedding
         } AS atom, score, hops
         ORDER BY score DESC, hops ASC
         LIMIT $k`,
        { embedding: queryEmbedding, anchorId: anchorAtomId, k, hops: dagHops }
      );

      return result.records.map(r => ({
        atom:  r.get("atom") as Neo4jMemoryNode,
        score: r.get("score") as number,
        hops:  r.get("hops") as number,
      }));
    } finally { await s.close(); }
  }

  // ── DAG ancestry traversal (for Executive context slice) ──────────
  async getAncestors(atomId: string, depth: number = 5): Promise<AtomicMemory[]> {
    const s = this.session();
    try {
      const result = await s.run(
        `MATCH (root:Memory { id: $id })<-[:PRECEDES*1..$depth]-(ancestor:Memory)
         RETURN ancestor
         ORDER BY ancestor.timestamp DESC
         LIMIT 20`,
        { id: atomId, depth }
      );
      return result.records.map(r => {
        const props = r.get("ancestor").properties;
        return {
          id:        props.id,
          type:      props.type,
          source:    props.source,
          timestamp: props.timestamp,
          title:     props.title ?? "",
          content:   props.content,
          tags:      props.tags ?? [],
          embedding: props.embedding ?? null,
          metadata: {
            confidence: props.confidence,
            importance: props.importance,
          },
          vertex_hash: props.vertex_hash,
          signature:   undefined,
        } as AtomicMemory;
      });
    } finally { await s.close(); }
  }

  // ── Policy conflict detection ─────────────────────────────────────
  async detectPolicyConflict(atomId: string, action: string): Promise<boolean> {
    const s = this.session();
    try {
      const result = await s.run(
        `MATCH (m:Memory { id: $id })<-[:INFLUENCED]-(p:Policy)
         WHERE p.type = 'routing' AND p.action <> $action
         RETURN count(p) AS conflicts`,
        { id: atomId, action }
      );
      return (result.records[0]?.get("conflicts").toNumber() ?? 0) > 0;
    } finally { await s.close(); }
  }

  // ── Write policy update from cortex learning loop ─────────────────
  async writePolicyUpdate(
    atom:          AtomicMemory,
    change:        string,
    newKnownType?: string
  ): Promise<void> {
    const s = this.session();
    try {
      await s.run(
        `MERGE (p:Policy { id: $policyId })
         SET p += { type: 'routing', action: $change, new_known_type: $newKnownType, created_at: $ts }
         WITH p
         MATCH (m:Memory { id: $atomId })
         MERGE (m)-[:INFLUENCED]->(p)`,
        {
          policyId:      `policy_${atom.id}_${Date.now()}`,
          change,
          newKnownType:  newKnownType ?? null,
          ts:            Date.now(),
          atomId:        atom.id,
        }
      );
    } finally { await s.close(); }
  }

  // ── GDS: PageRank over memory graph (cortex learning loop) ────────
  // Identifies most influential memory nodes for policy weighting.
  async runPageRank(): Promise<Array<{ id: string; score: number }>> {
    const s = this.session();
    try {
      await s.run(
        `CALL gds.graph.project.cypher(
           'memoryGraph',
           'MATCH (m:Memory) RETURN id(m) AS id',
           'MATCH (a:Memory)-[:PRECEDES]->(b:Memory) RETURN id(a) AS source, id(b) AS target'
         )`
      );
      const result = await s.run(
        `CALL gds.pageRank.stream('memoryGraph')
         YIELD nodeId, score
         MATCH (m:Memory) WHERE id(m) = nodeId
         RETURN m.id AS id, score
         ORDER BY score DESC LIMIT 100`
      );
      await s.run(`CALL gds.graph.drop('memoryGraph')`);
      return result.records.map(r => ({
        id:    r.get("id") as string,
        score: r.get("score") as number,
      }));
    } finally { await s.close(); }
  }

  async close(): Promise<void> { await this.driver.close(); }
}
