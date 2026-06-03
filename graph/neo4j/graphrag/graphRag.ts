import { CognitiveGraphRepository } from "../repositories/cognitiveGraphRepository.js";

export interface GraphRagContext {
  memoryId: string;
  relatedNodeIds: string[];
}

export interface GraphRagInterface {
  collectContext(memoryId: string): Promise<GraphRagContext>;
}

export class BasicGraphRag implements GraphRagInterface {
  constructor(private readonly repository: CognitiveGraphRepository) {}

  async collectContext(memoryId: string): Promise<GraphRagContext> {
    const context = await this.repository.getContext(memoryId);
    return {
      memoryId,
      relatedNodeIds: context.relatedNodeIds,
    };
  }
}
