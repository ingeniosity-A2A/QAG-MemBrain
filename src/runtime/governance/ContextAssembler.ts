import { ContextNode, TimelineEvent, AuthorityState, ToolDefinition } from './schemas.js';

export interface AssemblyConfig {
  maxTokens: number;
  objective: string;
  priorityOrder: AssemblyPriority[];
}

export type AssemblyPriority = 
  | 'objective'
  | 'memory'
  | 'graph'
  | 'tools'
  | 'policies';

export interface AssembledContext {
  objective: string;
  contextNodes: ContextNode[];
  memorySummary: string;
  toolDefinitions: ToolDefinition[];
  policies: string[];
  authorityState: AuthorityState;
  timeline: TimelineEvent[];
  tokenEstimate: number;
  compressed: boolean;
}

export class ContextAssembler {
  private config: AssemblyConfig;

  constructor(config: AssemblyConfig) {
    this.config = config;
  }

  assemble(
    objective: string,
    contextNodes: ContextNode[],
    memory: MemorySource,
    graph: GraphSource,
    tools: ToolSource,
    policies: PolicySource,
    authorityState: AuthorityState,
    timeline: TimelineEvent[]
  ): AssembledContext {
    let assembled: AssembledContext = {
      objective,
      contextNodes: [],
      memorySummary: '',
      toolDefinitions: [],
      policies: [],
      authorityState,
      timeline: [],
      tokenEstimate: 0,
      compressed: false,
    };

    for (const priority of this.config.priorityOrder) {
      switch (priority) {
        case 'objective':
          assembled = this.addObjective(assembled);
          break;
        case 'memory':
          assembled = this.addMemory(assembled, memory);
          break;
        case 'graph':
          assembled = this.addGraph(assembled, graph);
          break;
        case 'tools':
          assembled = this.addTools(assembled, tools);
          break;
        case 'policies':
          assembled = this.addPolicies(assembled, policies);
          break;
      }

      assembled.tokenEstimate = this.estimateTokens(assembled);
      
      if (assembled.tokenEstimate > this.config.maxTokens) {
        assembled = this.compress(assembled, priority);
      }
    }

    assembled.contextNodes = contextNodes;
    assembled.timeline = timeline.slice(-10);
    assembled.tokenEstimate = this.estimateTokens(assembled);

    return assembled;
  }

  private addObjective(context: AssembledContext): AssembledContext {
    return context;
  }

  private addMemory(context: AssembledContext, memory: MemorySource): AssembledContext {
    const summary = memory.getSummary(this.config.maxTokens * 0.3);
    return { ...context, memorySummary: summary };
  }

  private addGraph(context: AssembledContext, graph: GraphSource): AssembledContext {
    const entities = graph.getRelevantEntities(context.objective, 20);
    return { 
      ...context, 
      contextNodes: [...context.contextNodes, ...entities.map(e => ({
        id: e.id,
        type: e.type,
        state: e.state,
        dependencies: e.dependencies,
        authority: e.authority,
        timeline: [],
      }))] 
    };
  }

  private addTools(context: AssembledContext, tools: ToolSource): AssembledContext {
    const relevant = tools.getForObjective(context.objective);
    return { ...context, toolDefinitions: relevant };
  }

  private addPolicies(context: AssembledContext, policies: PolicySource): AssembledContext {
    const applicable = policies.getApplicable(context.objective);
    return { ...context, policies: applicable.map(p => p.id) };
  }

  private compress(context: AssembledContext, overflowPriority: AssemblyPriority): AssembledContext {
    const compressed = { ...context, compressed: true };

    switch (overflowPriority) {
      case 'policies':
        compressed.policies = compressed.policies.slice(0, 5);
        break;
      case 'tools':
        compressed.toolDefinitions = compressed.toolDefinitions.slice(0, 10);
        break;
      case 'graph':
        compressed.contextNodes = compressed.contextNodes.slice(0, 15);
        break;
      case 'memory':
        compressed.memorySummary = this.summarize(compressed.memorySummary, 0.5);
        break;
      case 'objective':
        break;
    }

    compressed.tokenEstimate = this.estimateTokens(compressed);
    
    if (compressed.tokenEstimate > this.config.maxTokens && overflowPriority !== 'objective') {
      const nextPriority = this.getNextPriority(overflowPriority);
      if (nextPriority) {
        return this.compress(compressed, nextPriority);
      }
    }

    return compressed;
  }

  private getNextPriority(current: AssemblyPriority): AssemblyPriority | null {
    const order = this.config.priorityOrder;
    const index = order.indexOf(current);
    if (index < order.length - 1) {
      return order[index + 1];
    }
    return null;
  }

  private summarize(text: string, ratio: number): string {
    const targetLength = Math.floor(text.length * ratio);
    if (text.length <= targetLength) return text;
    return text.slice(0, targetLength) + '... [compressed]';
  }

  private estimateTokens(context: AssembledContext): number {
    const jsonSize = JSON.stringify({
      objective: context.objective,
      memorySummary: context.memorySummary,
      contextNodes: context.contextNodes.length,
      toolDefinitions: context.toolDefinitions.length,
      policies: context.policies.length,
      timeline: context.timeline.length,
    }).length;
    
    return Math.ceil(jsonSize / 4);
  }
}

export interface MemorySource {
  getSummary(maxTokens: number): string;
}

export interface GraphSource {
  getRelevantEntities(objective: string, limit: number): Array<{
    id: string;
    type: string;
    state: Record<string, unknown>;
    dependencies: string[];
    authority: string;
  }>;
}

export interface ToolSource {
  getForObjective(objective: string): ToolDefinition[];
}

export interface PolicySource {
  getApplicable(objective: string): Array<{ id: string; name: string }>;
}