import type { Driver } from "neo4j-driver";
import { LOAD_GATE_CONFIG_QUERY } from "../../graph/neo4j/cypher/queries.js";
import { GateConfig } from "./types.js";

const DEFAULT_GATE_CONFIG: GateConfig = {
  reflexNfcSources: ["nfc"],
  reflexWebhookSources: ["webhook"],
  reflexKnownWebhookTypes: [],
  reflexKnownPatternTypes: ["nfc_tap"],
  reflexConfidenceThreshold: 0.85,
  reflexMaxPayloadBytes: 2048,
  reflexContextTokenBudget: 100,
  executiveContextTokenBudget: 500,
  cortexContextTokenBudget: 1000,
  executiveEscalationConfidence: 0.6,
  dagMaxDepth: 5,
};

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function loadGateConfig(driver: Driver): Promise<GateConfig> {
  const session = driver.session();
  try {
    const result = await session.run(LOAD_GATE_CONFIG_QUERY);

    if (result.records.length === 0) {
      return DEFAULT_GATE_CONFIG;
    }

    const policy = result.records[0].get("p") as { properties?: Record<string, unknown> };
    const properties = policy.properties ?? {};
    const dagMaxDepth = Math.min(5, Math.max(1, Math.trunc(numberValue(properties.dagMaxDepth, 5))));

    return {
      reflexNfcSources: stringList(properties.reflexNfcSources, DEFAULT_GATE_CONFIG.reflexNfcSources),
      reflexWebhookSources: stringList(properties.reflexWebhookSources, DEFAULT_GATE_CONFIG.reflexWebhookSources),
      reflexKnownWebhookTypes: stringList(
        properties.reflexKnownWebhookTypes,
        DEFAULT_GATE_CONFIG.reflexKnownWebhookTypes,
      ),
      reflexKnownPatternTypes: stringList(
        properties.reflexKnownPatternTypes,
        DEFAULT_GATE_CONFIG.reflexKnownPatternTypes,
      ),
      reflexConfidenceThreshold: numberValue(
        properties.reflexConfidenceThreshold,
        DEFAULT_GATE_CONFIG.reflexConfidenceThreshold,
      ),
      reflexMaxPayloadBytes: numberValue(properties.reflexMaxPayloadBytes, DEFAULT_GATE_CONFIG.reflexMaxPayloadBytes),
      reflexContextTokenBudget: numberValue(
        properties.reflexContextTokenBudget,
        DEFAULT_GATE_CONFIG.reflexContextTokenBudget,
      ),
      executiveContextTokenBudget: numberValue(
        properties.executiveContextTokenBudget,
        DEFAULT_GATE_CONFIG.executiveContextTokenBudget,
      ),
      cortexContextTokenBudget: numberValue(
        properties.cortexContextTokenBudget,
        DEFAULT_GATE_CONFIG.cortexContextTokenBudget,
      ),
      executiveEscalationConfidence: numberValue(
        properties.executiveEscalationConfidence,
        DEFAULT_GATE_CONFIG.executiveEscalationConfidence,
      ),
      dagMaxDepth,
      activePolicyVersion: typeof properties.version === "string" ? properties.version : undefined,
    };
  } finally {
    await session.close();
  }
}
