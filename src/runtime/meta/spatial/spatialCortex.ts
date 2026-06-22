import { ReplayDeltaEntry } from "../../authority/replay/replayDedup.js";
import { ReplayRecord } from "../../authority/service/replayRecord.js";

export interface MemoryAtom {
  atomId: string;
  type: string;
  relationships: string[];
  timestamp: string;
  authorityRoot: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SpatialRelationship {
  fromAtomId: string;
  toAtomId: string;
  relation:
    | "requested"
    | "contains"
    | "depends_on"
    | "references"
    | "approved"
    | "attached_to"
    | "generated_by"
    | "influenced_by"
    | "verified_by"
    | "originated_from"
    | "modified_by"
    | "lineage_of";
  timestamp: string;
}

export interface SpatialRoom {
  roomId: string;
  name: string;
  description: string;
}

export interface SpatialZone {
  zoneId: string;
  roomId: string;
  name: string;
  description: string;
}

export interface SpatialPath {
  pathId: string;
  fromZoneId: string;
  toZoneId: string;
  relation: "adjacent" | "contains" | "links";
}

export interface SpatialLocation {
  atomId: string;
  roomId: string;
  zoneId: string;
}

export interface SpatialQuery {
  centerAtomId: string;
  maxDepth?: number;
}

export interface SpatialReconstruction {
  visitedAtoms: MemoryAtom[];
  traversedRelationships: SpatialRelationship[];
}

export class SpatialCortex {
  private readonly atoms = new Map<string, MemoryAtom>();
  private readonly outgoing = new Map<string, SpatialRelationship[]>();
  private readonly incoming = new Map<string, SpatialRelationship[]>();
  private readonly rooms = new Map<string, SpatialRoom>();
  private readonly zones = new Map<string, SpatialZone>();
  private readonly paths = new Map<string, SpatialPath>();
  private readonly locations = new Map<string, SpatialLocation>();

  upsertAtom(atom: MemoryAtom): void {
    this.atoms.set(atom.atomId, {
      ...atom,
      relationships: [...atom.relationships],
    });
  }

  addRelationship(relationship: SpatialRelationship): void {
    const current = this.outgoing.get(relationship.fromAtomId) ?? [];
    current.push({ ...relationship });
    this.outgoing.set(relationship.fromAtomId, current);

    const incoming = this.incoming.get(relationship.toAtomId) ?? [];
    incoming.push({ ...relationship });
    this.incoming.set(relationship.toAtomId, incoming);
  }

  getAtom(atomId: string): MemoryAtom | null {
    return this.atoms.get(atomId) ?? null;
  }

  getOutgoing(atomId: string): SpatialRelationship[] {
    return [...(this.outgoing.get(atomId) ?? [])];
  }

  getIncoming(atomId: string): SpatialRelationship[] {
    return [...(this.incoming.get(atomId) ?? [])];
  }

  upsertRoom(room: SpatialRoom): void {
    this.rooms.set(room.roomId, { ...room });
  }

  upsertZone(zone: SpatialZone): void {
    this.zones.set(zone.zoneId, { ...zone });
  }

  upsertPath(path: SpatialPath): void {
    this.paths.set(path.pathId, { ...path });
  }

  setAtomLocation(location: SpatialLocation): void {
    this.locations.set(location.atomId, { ...location });
  }

  getAtomLocation(atomId: string): SpatialLocation | null {
    return this.locations.get(atomId) ?? null;
  }

  getAtomsInZone(zoneId: string): MemoryAtom[] {
    const atomIds = Array.from(this.locations.values())
      .filter((location) => location.zoneId === zoneId)
      .map((location) => location.atomId);

    return atomIds
      .map((atomId) => this.atoms.get(atomId))
      .filter((atom): atom is MemoryAtom => Boolean(atom));
  }

  reconstruct(query: SpatialQuery): SpatialReconstruction {
    const maxDepth = typeof query.maxDepth === "number" && query.maxDepth > 0 ? query.maxDepth : 3;
    const queue: Array<{ atomId: string; depth: number }> = [{ atomId: query.centerAtomId, depth: 0 }];
    const visitedAtomIds = new Set<string>();
    const traversedRelationships: SpatialRelationship[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (visitedAtomIds.has(current.atomId)) {
        continue;
      }

      visitedAtomIds.add(current.atomId);
      if (current.depth >= maxDepth) {
        continue;
      }

      const relationships = this.outgoing.get(current.atomId) ?? [];
      for (const relationship of relationships) {
        traversedRelationships.push(relationship);
        queue.push({ atomId: relationship.toAtomId, depth: current.depth + 1 });
      }
    }

    const visitedAtoms = Array.from(visitedAtomIds)
      .map((atomId) => this.atoms.get(atomId))
      .filter((atom): atom is MemoryAtom => Boolean(atom));

    return {
      visitedAtoms,
      traversedRelationships,
    };
  }
}

export function atomFromReplayDelta(delta: ReplayDeltaEntry, authorityRoot: string): MemoryAtom {
  return {
    atomId: delta.replayId,
    type: "MemoryAtom",
    relationships: [delta.decisionId, delta.lineageId],
    timestamp: delta.timestamp,
    authorityRoot,
    metadata: {
      status: delta.status,
      failureReasons: delta.failureReasons.length,
    },
  };
}

export function atomFromReplayRecord(record: ReplayRecord): MemoryAtom {
  return {
    atomId: record.replayId,
    type: "MemoryAtom",
    relationships: [record.decisionId, record.lineageId, record.releaseId],
    timestamp: record.timestamp,
    authorityRoot: record.signature.artifactHash,
    metadata: {
      status: record.status,
      governanceVersion: record.governanceVersion,
      environment: record.environment,
    },
  };
}

export function relationshipsFromReplayRecord(record: ReplayRecord): SpatialRelationship[] {
  const timestamp = record.timestamp;
  const policyId = `approval-policy:${record.governanceVersion}`;
  const governanceRuleId = `governance-rule:${record.governanceHash}`;
  const deploymentVersionId = `deployment-version:${record.deploymentVersion}`;
  const signatureId = `authority-signature:${record.signature.signatureId}`;

  return [
    {
      fromAtomId: record.decisionId,
      toAtomId: record.replayId,
      relation: "generated_by",
      timestamp,
    },
    {
      fromAtomId: record.replayId,
      toAtomId: record.lineageId,
      relation: "influenced_by",
      timestamp,
    },
    {
      fromAtomId: record.replayId,
      toAtomId: record.releaseId,
      relation: "approved",
      timestamp,
    },
    {
      fromAtomId: record.replayId,
      toAtomId: record.signature.authorityId ?? record.signature.signerId,
      relation: "verified_by",
      timestamp,
    },
    {
      fromAtomId: record.decisionId,
      toAtomId: policyId,
      relation: "influenced_by",
      timestamp,
    },
    {
      fromAtomId: policyId,
      toAtomId: governanceRuleId,
      relation: "originated_from",
      timestamp,
    },
    {
      fromAtomId: governanceRuleId,
      toAtomId: deploymentVersionId,
      relation: "modified_by",
      timestamp,
    },
    {
      fromAtomId: deploymentVersionId,
      toAtomId: signatureId,
      relation: "verified_by",
      timestamp,
    },
    {
      fromAtomId: record.lineageId,
      toAtomId: record.decisionId,
      relation: "lineage_of",
      timestamp,
    },
  ];
}

export function derivedAtomIdsFromReplayRecord(record: ReplayRecord): string[] {
  return [
    record.decisionId,
    record.lineageId,
    record.releaseId,
    record.signature.authorityId ?? record.signature.signerId,
    `approval-policy:${record.governanceVersion}`,
    `governance-rule:${record.governanceHash}`,
    `deployment-version:${record.deploymentVersion}`,
    `authority-signature:${record.signature.signatureId}`,
  ];
}
