import { RevikeMemoryChunk } from "../../graph/neo4j/repositories/revikeRetrievalRepository.js";

export interface Mercury2SynthesisInput {
  requestId: string;
  tacticalSituation: string;
  retrievedChunks: RevikeMemoryChunk[];
}

export interface Mercury2SynthesisOutput {
  philosophical_diagnosis: string;
  strategic_advice: string;
  tactical_directive: string;
}

export interface Mercury2SynthesisClient {
  synthesize(input: Mercury2SynthesisInput): Promise<Mercury2SynthesisOutput>;
}

export class DeterministicMercury2SynthesisClient implements Mercury2SynthesisClient {
  async synthesize(input: Mercury2SynthesisInput): Promise<Mercury2SynthesisOutput> {
    const excerpt = input.retrievedChunks[0]?.content ?? "Command and clarity resolve delay.";
    return {
      philosophical_diagnosis: "Delay is a mind-level concession, not a material limit.",
      strategic_advice: `Anchor authority, then move execution in one command cycle. Reference: ${excerpt}`,
      tactical_directive: "Tell the field team to frame the adjustment as complete-in-progress and execute the correction immediately.",
    };
  }
}

export class HttpMercury2SynthesisClient implements Mercury2SynthesisClient {
  constructor(private readonly endpoint: string) {}

  async synthesize(input: Mercury2SynthesisInput): Promise<Mercury2SynthesisOutput> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request_id: input.requestId,
        tactical_situation: input.tacticalSituation,
        retrieved_chunks: input.retrievedChunks,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mercury2 synthesis failed with status ${response.status}`);
    }

    const parsed = (await response.json()) as Partial<Mercury2SynthesisOutput>;
    if (
      typeof parsed.philosophical_diagnosis !== "string" ||
      typeof parsed.strategic_advice !== "string" ||
      typeof parsed.tactical_directive !== "string"
    ) {
      throw new Error("Mercury2 synthesis response is malformed");
    }

    return {
      philosophical_diagnosis: parsed.philosophical_diagnosis,
      strategic_advice: parsed.strategic_advice,
      tactical_directive: parsed.tactical_directive,
    };
  }
}
