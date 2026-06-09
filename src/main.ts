import { ReflexEngine } from "./reflex/engine.js";
import { Mellum2Client } from "./executive/mellum2_client.js";
import { Mercury2Client } from "./cortex/mercury2_client.js";
import { TashiNode } from "./tashi/node.js";
import { Ava007Coordinator } from "./agent/ava007_coordinator.js";
import { GooseExecutor } from "./agent/goose_executor.js";
import { RevIkeRuntime } from "./agent/rev_ike_runtime.js";

async function main() {
  const reflex = new ReflexEngine();
  const mellum2 = new Mellum2Client();
  const mercury2 = new Mercury2Client();
  const tashi = new TashiNode("did:ava:local-node", "./data/memory.jsonl");
  const goose = new GooseExecutor();
  const revIke = new RevIkeRuntime();
  const coordinator = new Ava007Coordinator(reflex, mellum2, mercury2, tashi, goose, revIke);

  const decision = await coordinator.route({
    intent: "voice_call",
    confidence: 0.97,
    payload: { callee: "+1234567890" },
  });

  console.log("Final decision:", decision);
}

main().catch(console.error);
