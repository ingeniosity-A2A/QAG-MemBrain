import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RuntimeAction, RuntimeTier } from "./types.js";

export interface TierAuditRecord {
  id: string;
  type: "tier_decision";
  atomId: string;
  tier: RuntimeTier;
  action: RuntimeAction;
  gateReason: string;
  confidence?: number;
  contextTokenBudget: number;
  latencyMs: number;
  timestamp: string;
}

export async function appendTierAuditRecord(filePath: string, record: TierAuditRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}
