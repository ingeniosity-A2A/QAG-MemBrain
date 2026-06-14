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

CREATE CONSTRAINT replay_id_unique IF NOT EXISTS
FOR (n:Replay)
REQUIRE n.id IS UNIQUE;

CREATE INDEX memory_type_idx IF NOT EXISTS
FOR (n:Memory)
ON (n.type);

CREATE INDEX memory_source_idx IF NOT EXISTS
FOR (n:Memory)
ON (n.source);

CREATE INDEX policy_scope_idx IF NOT EXISTS
FOR (n:Policy)
ON (n.scope);

CREATE VECTOR INDEX memory_embedding_idx IF NOT EXISTS
FOR (n:Memory)
ON (n.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 1536,
    `vector.similarity_function`: 'cosine'
  }
};

MERGE (p:Policy {id: 'ava007_gate_config_v1'})
SET p.scope = 'ava007_gate_config',
    p.active = true,
    p.version = '1',
    p.reflexNfcSources = ['nfc'],
    p.reflexWebhookSources = ['webhook'],
    p.reflexKnownWebhookTypes = [],
    p.reflexKnownPatternTypes = ['nfc_tap'],
    p.reflexConfidenceThreshold = 0.85,
    p.reflexMaxPayloadBytes = 2048,
    p.reflexContextTokenBudget = 100,
    p.executiveContextTokenBudget = 500,
    p.cortexContextTokenBudget = 1000,
    p.executiveEscalationConfidence = 0.60,
    p.dagMaxDepth = 5,
    p.createdAt = coalesce(p.createdAt, datetime());
