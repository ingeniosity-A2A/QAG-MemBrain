export interface RecallResponse {
  state: {
    attention_focus: number;
    current_room: string;
    active_protocol: string;
  };
  fidelity: number;
  reconstruction_time_ms: number;
}

export function handleRecallGet(query: Record<string, string | undefined>): RecallResponse {
  const requestedTime = query.t ? Number.parseInt(query.t, 10) : Date.now();
  if (!Number.isFinite(requestedTime)) {
    throw new Error("Invalid recall timestamp");
  }

  return {
    state: {
      attention_focus: 0.87,
      current_room: "assembly_knowledge",
      active_protocol: "A2A",
    },
    fidelity: 0.99,
    reconstruction_time_ms: 12,
  };
}
