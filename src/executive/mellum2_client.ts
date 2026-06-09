import { AtomicMemory, AVA007Decision } from "../shared/types.js";

export interface Mellum2Request {
  prompt: string;
  context: AtomicMemory[];
  maxTokens: number;
}

export interface Mellum2Response {
  decision: AVA007Decision;
  confidence: number;
  tokensUsed: number;
}

export class Mellum2Client {
  async evaluate(request: Mellum2Request): Promise<Mellum2Response> {
    const confidence = 0.75;
    const escalate = confidence < 0.6;
    const decision: AVA007Decision = {
      action: "delegate_to_cortex",
      params: { originalPrompt: request.prompt },
      escalate,
      confidence,
      reason: escalate ? "confidence below threshold" : "standard routing",
    };
    return { decision, confidence, tokensUsed: request.prompt.length };
  }
}
