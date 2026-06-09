import { ReflexEngine } from "../reflex/engine.js";
import { Mellum2Client } from "../executive/mellum2_client.js";
import { Mercury2Client } from "../cortex/mercury2_client.js";
import { TashiNode } from "../tashi/node.js";
import { ObservationProposal, AVA007Decision } from "../shared/types.js";
import { GooseExecutor } from "./goose_executor.js";
import { RevIkeRuntime } from "./rev_ike_runtime.js";

export class Ava007Coordinator {
  constructor(
    private reflex: ReflexEngine,
    private mellum2: Mellum2Client,
    private mercury2: Mercury2Client,
    private tashi: TashiNode,
    private goose: GooseExecutor,
    private revIke: RevIkeRuntime,
  ) {}

  async route(obs: ObservationProposal): Promise<AVA007Decision> {
    const reflexResult = this.reflex.execute(obs);
    if (reflexResult.matched && reflexResult.action) {
      return {
        action: reflexResult.action,
        params: {},
        escalate: false,
        confidence: reflexResult.confidence,
        reason: "reflex cache hit",
      };
    }

    const context = this.tashi.getAncestors("", 5);
    const mellumResp = await this.mellum2.evaluate({
      prompt: obs.intent,
      context: context.map((v) => v.data),
      maxTokens: 500,
    });

    if (!mellumResp.decision.escalate) {
      if (mellumResp.decision.action !== "delegate_to_cortex") {
        await this.goose.execute(mellumResp.decision);
      }
      return mellumResp.decision;
    }

    const cortexResp = await this.mercury2.deepReason({
      packet: {
        intent: obs.intent,
        fullContext: context.map((v) => v.data),
        signalMetadata: { originalConfidence: obs.confidence },
      },
    });
    await this.tashi.submit(cortexResp.auditAtom, "cortex_signature_placeholder");
    await this.revIke.execute(cortexResp.newDecision);
    return cortexResp.newDecision;
  }
}
