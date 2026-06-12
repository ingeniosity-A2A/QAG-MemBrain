import { createAtomicMemory } from "../memory/jsonl/atomic_memory.js";
import { InteractionQuantum } from "../shared/types.js";

export function createInteractionQuantum(input: {
  source: string;
  content: string;
  rssi_dbm?: number;
  snr_db?: number;
  frequency_hz?: number;
}): InteractionQuantum {
  return {
    ...createAtomicMemory({ type: "quantum", source: input.source, content: input.content, metadata: {} }),
    type: "quantum",
    rf_physical: input.frequency_hz === undefined || input.rssi_dbm === undefined || input.snr_db === undefined
      ? undefined
      : { frequency_hz: input.frequency_hz, rssi_dbm: input.rssi_dbm, snr_db: input.snr_db },
    temporal_index: { gsap_ticker_ms: Date.now(), doppler_hz: 0 },
  };
}
