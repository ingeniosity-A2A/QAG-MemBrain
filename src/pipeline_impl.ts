import { AtomicInteractionGraph } from "./graph/neo4j/graphrag.js";
import { LoRaPacket } from "./hal/lora_bridge.js";
import { JSONLMemoryStore } from "./memory/jsonl/atomic_memory.js";
import { TashiNode } from "./consensus/tashi/tashi_node.js";
import { createInteractionQuantum } from "./quantum/interaction_quantum.js";
import { RevIke } from "./subconscious/rev_ike.js";
import { Ava007 } from "./brain/ava007.js";

export class QuantumAtomicMemBrain {
  readonly memory = new JSONLMemoryStore("./data/memory.jsonl");
  readonly tashi = new TashiNode("edge-node", "./data/tashi/vertices.jsonl");
  readonly graph = new AtomicInteractionGraph();
  readonly revIke = new RevIke();
  readonly ava007 = new Ava007(this.memory);

  async processLoRaPacket(packet: LoRaPacket): Promise<string> {
    const quantum = createInteractionQuantum({
      source: "lora",
      content: packet.payload,
      rssi_dbm: packet.rssi,
      snr_db: packet.snr,
      frequency_hz: 915_000_000,
    });
    await this.memory.append(quantum, "L1");
    await this.tashi.submit(quantum, {
      timelineId: "edge",
      time: packet.timestamp,
      seed: quantum.fingerprint ?? quantum.id,
      velocity: packet.snr,
    });
    await this.graph.store(quantum);
    const proposal = this.revIke.observe(packet.payload, { quantum_id: quantum.id });
    await this.ava007.evaluate(proposal);
    return quantum.id;
  }
}

async function main(): Promise<void> {
  const pipeline = new QuantumAtomicMemBrain();
  const id = await pipeline.processLoRaPacket({
    type: "lora_packet",
    timestamp: Date.now(),
    rssi: -45,
    snr: 9.2,
    payload: "stalled hardware test packet",
  });
  process.stdout.write(`Quantum Atomic MemBrain processed ${id}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
