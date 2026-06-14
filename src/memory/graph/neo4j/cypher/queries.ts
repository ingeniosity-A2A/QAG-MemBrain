export const LOAD_GATE_CONFIG_QUERY = `
  MATCH (p:Policy {scope: 'ava007_gate_config'})
  WHERE coalesce(p.active, true) = true
  RETURN p
  ORDER BY coalesce(p.version, 0) DESC, coalesce(p.createdAt, '') DESC
  LIMIT 1
`;

export const LOAD_DAG_SLICE_QUERY = `
  MATCH path = (root {id: $atomId})<-[:RELATED_TO|INFLUENCED_BY|GENERATED|REFERENCES|SUPPORTS|CONTRADICTS*0..5]-(ancestor)
  WITH path
  WHERE length(path) <= $maxDepth
  RETURN path
`;

export const LOAD_POLICY_CONFLICTS_QUERY = `
  MATCH (p:Policy)-[r:CONTRADICTS]-(other:Policy)
  WHERE p.id IN $policyIds OR other.id IN $policyIds
  RETURN
    p.id AS policyId,
    p.version AS policyVersion,
    other.id AS conflictsWithId,
    other.version AS conflictsWithVersion,
    r.reason AS reason
`;

export const GRAPH_RAG_CONTEXT_QUERY = `
  CALL db.index.vector.queryNodes('memory_embedding_idx', $topK, $embedding)
  YIELD node, score
  MATCH path = (node)-[:RELATED_TO|INFLUENCED_BY|GENERATED|REFERENCES|SUPPORTS|CONTRADICTS*0..5]-(neighbor:Memory)
  WITH node, score, path, neighbor
  WHERE length(path) <= $depth
  RETURN
    node.id AS seedId,
    score,
    collect(DISTINCT neighbor.id) AS contextIds,
    collect(DISTINCT [rel IN relationships(path) | {
      type: type(rel),
      fromId: startNode(rel).id,
      toId: endNode(rel).id,
      properties: properties(rel)
    }]) AS relationshipPaths
  ORDER BY score DESC
  LIMIT $topK
`;
