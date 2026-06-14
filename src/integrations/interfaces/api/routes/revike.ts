import {
  DeterministicMercury2SynthesisClient,
  HttpMercury2SynthesisClient,
  Mercury2SynthesisClient,
} from "../../../../agent/cortex/executive/mercury2SynthesisClient.js";
import {
  buildGemmaTransformerPrompt,
  transformTacticalToPhilosophical,
} from "../../../../agent/cortex/reflex/gemmaQueryTransformer.js";
import {
  DEFAULT_REVIKE_MEMORIES,
  InMemoryRevikeRetrievalRepository,
  RevikeRetrievalRepository,
} from "../../../../memory/graph/neo4j/repositories/revikeRetrievalRepository.js";

export interface RevikeRequest {
  request_id: string;
  operational_context: string;
  location?: string;
  required_output?: "json" | "audio";
}

export interface RevikeResponse {
  philosophical_diagnosis: string;
  strategic_advice: string;
  tactical_directive: string;
  audio_asset_url?: string;
  retrieval: {
    themes: string[];
    memory_ids: string[];
  };
}

export interface RevikeRouteDependencies {
  retrievalRepository: RevikeRetrievalRepository;
  synthesisClient: Mercury2SynthesisClient;
}

export function createRevikeRouteDependencies(): RevikeRouteDependencies {
  const retrievalRepository = new InMemoryRevikeRetrievalRepository(DEFAULT_REVIKE_MEMORIES);
  const synthesisClient = process.env.MERCURY2_ENDPOINT
    ? new HttpMercury2SynthesisClient(process.env.MERCURY2_ENDPOINT)
    : new DeterministicMercury2SynthesisClient();

  return {
    retrievalRepository,
    synthesisClient,
  };
}

export async function handleRevikePost(
  body: unknown,
  dependencies: RevikeRouteDependencies = createRevikeRouteDependencies(),
): Promise<RevikeResponse> {
  const candidate = body as Partial<RevikeRequest> | undefined;
  if (!candidate || typeof candidate.request_id !== "string" || typeof candidate.operational_context !== "string") {
    throw new Error("Invalid REV.IKE payload");
  }

  const transformed = transformTacticalToPhilosophical(candidate.operational_context);
  const _prompt = buildGemmaTransformerPrompt(candidate.operational_context);

  const retrievedChunks = await dependencies.retrievalRepository.retrieveRelevantMemories({
    query: transformed.query,
    themes: transformed.themes,
    keywords: transformed.keywords,
    location: candidate.location,
    limit: 4,
  });

  const synthesis = await dependencies.synthesisClient.synthesize({
    requestId: candidate.request_id,
    tacticalSituation: candidate.operational_context,
    retrievedChunks,
  });

  return {
    philosophical_diagnosis: synthesis.philosophical_diagnosis,
    strategic_advice: synthesis.strategic_advice,
    tactical_directive: synthesis.tactical_directive,
    audio_asset_url: candidate.required_output === "audio" ? `https://storage.local/revike/${candidate.request_id}.mp3` : undefined,
    retrieval: {
      themes: transformed.themes,
      memory_ids: retrievedChunks.map((chunk: any) => chunk.id),
    },
  };
}
