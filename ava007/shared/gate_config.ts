import { InputType } from "./types.js";

export interface GateConfig {
  reflex_pass_confidence: number;
  reflex_known_types: InputType[];
  reflex_max_importance: "low" | "medium";
  executive_pass_confidence: number;
  executive_max_dag_depth: number;
  cortex_force_importance: "critical";
  last_updated: number;
  version: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  reflex_pass_confidence: 0.85,
  reflex_known_types: ["nfc_tap", "a2a_post", "webhook_known"],
  reflex_max_importance: "medium",
  executive_pass_confidence: 0.6,
  executive_max_dag_depth: 5,
  cortex_force_importance: "critical",
  last_updated: Date.now(),
  version: 1,
};

export async function loadGateConfig(neo4jDriver?: unknown): Promise<GateConfig> {
  if (!neo4jDriver || typeof neo4jDriver !== "object" || !("session" in neo4jDriver)) {
    return DEFAULT_GATE_CONFIG;
  }

  const driver = neo4jDriver as {
    session: () => {
      run: (query: string) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
      close: () => Promise<void>;
    };
  };
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (p:Policy {type: 'gate_config'})
      RETURN p
      ORDER BY coalesce(p.version, 0) DESC, coalesce(p.last_updated, 0) DESC
      LIMIT 1
    `);

    if (result.records.length === 0) {
      return DEFAULT_GATE_CONFIG;
    }

    const node = result.records[0].get("p") as { properties?: Partial<GateConfig> };
    return {
      ...DEFAULT_GATE_CONFIG,
      ...node.properties,
      cortex_force_importance: "critical",
    };
  } finally {
    await session.close();
  }
}
