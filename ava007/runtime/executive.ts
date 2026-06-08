import neo4j, { Driver, Node, Relationship } from "neo4j-driver";
import { LOAD_DAG_SLICE_QUERY, LOAD_POLICY_CONFLICTS_QUERY } from "../../graph/neo4j/cypher/queries.js";
import { evaluateExecutiveGate, ExecutiveGateDecision } from "./escalation_gates.js";
import {
  Atom,
  CortexPacket,
  DagRelationship,
  DagSlice,
  GateConfig,
  Mellum2Client,
  Mellum2Response,
  PolicyConflict,
  neo4jOptionalString,
  neo4jProperties,
  neo4jString,
} from "./types.js";

export interface ExecutiveResult {
  decision: Mellum2Response;
  gate: ExecutiveGateDecision;
  packet?: CortexPacket;
}

function nodeToDagNode(node: Node, depth: number) {
  return {
    id: String(node.properties.id ?? node.elementId),
    labels: [...node.labels],
    properties: neo4jProperties(node.properties),
    depth,
  };
}

function relationshipToDagRelationship(relationship: Relationship, nodesByElementId: Map<string, Node>, depth: number): DagRelationship {
  const start = nodesByElementId.get(relationship.startNodeElementId);
  const end = nodesByElementId.get(relationship.endNodeElementId);
  return {
    fromId: String(start?.properties.id ?? relationship.startNodeElementId),
    toId: String(end?.properties.id ?? relationship.endNodeElementId),
    type: relationship.type,
    properties: neo4jProperties(relationship.properties),
    depth,
  };
}

export async function loadDagSlice(driver: Driver, atomId: string, maxDepth: number): Promise<DagSlice> {
  const session = driver.session();
  try {
    const result = await session.run(LOAD_DAG_SLICE_QUERY, { atomId, maxDepth: neo4j.int(maxDepth) });

    const nodesByElementId = new Map<string, { node: Node; depth: number }>();
    const relationships = new Map<string, DagRelationship>();

    for (const record of result.records) {
      const path = record.get("path") as {
        segments: Array<{ start: Node; relationship: Relationship; end: Node }>;
        start: Node;
        end: Node;
      };
      nodesByElementId.set(path.start.elementId, { node: path.start, depth: 0 });

      path.segments.forEach((segment, index) => {
        const depth = index + 1;
        const existingStart = nodesByElementId.get(segment.start.elementId);
        const existingEnd = nodesByElementId.get(segment.end.elementId);
        nodesByElementId.set(segment.start.elementId, {
          node: segment.start,
          depth: existingStart ? Math.min(existingStart.depth, depth) : depth,
        });
        nodesByElementId.set(segment.end.elementId, {
          node: segment.end,
          depth: existingEnd ? Math.min(existingEnd.depth, depth) : depth,
        });

        const nodeMap = new Map([...nodesByElementId.entries()].map(([id, entry]) => [id, entry.node]));
        relationships.set(
          segment.relationship.elementId,
          relationshipToDagRelationship(segment.relationship, nodeMap, depth),
        );
      });
    }

    return {
      rootId: atomId,
      maxDepth,
      nodes: [...nodesByElementId.values()].map((entry) => nodeToDagNode(entry.node, entry.depth)),
      relationships: [...relationships.values()],
    };
  } finally {
    await session.close();
  }
}

export async function loadPolicyConflicts(driver: Driver, policyIds: string[]): Promise<PolicyConflict[]> {
  if (policyIds.length === 0) {
    return [];
  }

  const session = driver.session();
  try {
    const result = await session.run(LOAD_POLICY_CONFLICTS_QUERY, { policyIds });

    return result.records.map((record) => ({
      policyId: neo4jString(record, "policyId"),
      policyVersion: neo4jOptionalString(record, "policyVersion"),
      conflictsWithId: neo4jString(record, "conflictsWithId"),
      conflictsWithVersion: neo4jOptionalString(record, "conflictsWithVersion"),
      reason: neo4jOptionalString(record, "reason"),
    }));
  } finally {
    await session.close();
  }
}

export async function runExecutive(input: {
  atom: Atom;
  driver: Driver;
  mellum2: Mellum2Client;
  gateConfig: GateConfig;
  now: () => Date;
}): Promise<ExecutiveResult> {
  const dagSlice = await loadDagSlice(input.driver, input.atom.id, input.gateConfig.dagMaxDepth);
  const policyConflicts = await loadPolicyConflicts(input.driver, input.atom.policyIds ?? []);
  const decision = await input.mellum2.evaluate({
    atom: input.atom,
    dagSlice,
    policyConflicts,
    gateConfig: input.gateConfig,
  });

  const gate = evaluateExecutiveGate({
    decision,
    config: input.gateConfig,
    dagSlice,
    policyConflicts,
    atom: input.atom,
  });

  if (gate.target !== "cortex") {
    return { decision, gate };
  }

  return {
    decision,
    gate,
    packet: {
      packetId: `${input.atom.id}:cortex:${input.now().getTime()}`,
      atom: input.atom,
      dagSlice,
      policyConflicts,
      executiveDecision: decision,
      gateConfig: input.gateConfig,
      assembledAt: input.now().toISOString(),
    },
  };
}
