/**
 * Mercury 2 – Cortex LLM Synthesis Client
 * Ported from cognition/executive/mercury2SynthesisClient.ts
 * into canonical src/ structure. Self-contained, no broken imports.
 */
import type {
  Mercury2Client,
  Mercury2Request,
  Mercury2Response,
  CortexPacket,
} from './coordination_types.js';

// ─── Deterministic (stub) implementation ─────────────────────────────

export class DeterministicMercury2Client implements Mercury2Client {
  async generateBlock(request: Mercury2Request): Promise<Mercury2Response> {
    const packet: CortexPacket = request.packet;
    const atomType = packet.atom.type;
    const atomSource = packet.atom.source;

    return {
      action: 'cortex_action',
      confidence: 0.9,
      block: `Cortex decision for ${atomType} from ${atomSource}. ` +
        `Philosophical diagnosis: Delay is a mind-level concession, not a material limit. ` +
        `Strategic advice: Anchor authority, then move execution in one command cycle. ` +
        `Tactical directive: Frame the adjustment as complete-in-progress and execute the correction immediately.`,
    };
  }
}

// ─── HTTP implementation (calls remote Mercury 2 endpoint) ───────────

export class HttpMercury2Client implements Mercury2Client {
  constructor(private readonly endpoint: string) {}

  async generateBlock(request: Mercury2Request): Promise<Mercury2Response> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: request.packet.packetId,
        tactical_situation: request.packet.atom.source,
        packet: request.packet,
        prompt: request.prompt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mercury2 synthesis failed with status ${response.status}`);
    }

    const parsed = (await response.json()) as Partial<Mercury2Response>;
    if (
      typeof parsed.action !== 'string' ||
      typeof parsed.confidence !== 'number' ||
      typeof parsed.block !== 'string'
    ) {
      throw new Error('Mercury2 synthesis response is malformed');
    }

    return {
      action: parsed.action,
      confidence: parsed.confidence,
      block: parsed.block,
      policyChange: parsed.policyChange,
    };
  }
}

/**
 * Build the Mercury 2 prompt from a CortexPacket.
 * Mercury 2 receives only complete packets. Reject all implicit repair,
 * partial context requests, and speculative policy mutation.
 */
export function buildMercuryPrompt(packet: CortexPacket): string {
  return `
AVA007 CORTEX PACKET

Mercury 2 receives only complete packets. Reject all implicit repair, partial context requests, and speculative
policy mutation. The output must be one complete block because Mercury 2 diffusion latency is effectively flat
with respect to this response length; use the available budget to produce a final deterministic decision.

Packet:
${JSON.stringify(packet, null, 2)}

Return a complete action block. If policy change is required, include a successor policy payload only; never mutate
or overwrite prior policy atoms.
`.trim();
}
