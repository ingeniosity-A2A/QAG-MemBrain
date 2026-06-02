// Phase 1 foundation schema for QAG_MemBrain Layer 3.

CREATE CONSTRAINT memory_id_unique IF NOT EXISTS
FOR (n:Memory)
REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT policy_id_unique IF NOT EXISTS
FOR (n:Policy)
REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT agent_id_unique IF NOT EXISTS
FOR (n:Agent)
REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT decision_id_unique IF NOT EXISTS
FOR (n:Decision)
REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT session_id_unique IF NOT EXISTS
FOR (n:Session)
REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT document_id_unique IF NOT EXISTS
FOR (n:Document)
REQUIRE n.id IS UNIQUE;

CREATE VECTOR INDEX memory_embedding_idx IF NOT EXISTS
FOR (n:Memory)
ON (n.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 1536,
    `vector.similarity_function`: 'cosine'
  }
};
