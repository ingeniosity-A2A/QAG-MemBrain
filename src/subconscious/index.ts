import { MemoryStore, type MemoryEntry } from '../memory/jsonl/index.js';
import { GraphStore } from '../graph/neo4j/index.js';

export class WriteDeniedError extends Error {
  constructor(method: string) {
    super(`L5 Subconscious: ${method}() is forbidden. Layer 5 is read-only.`);
    this.name = 'WriteDeniedError';
  }
}

// ─── CFGL Routing Types ──────────────────────────────────────────────

export type CFGLEntry = 'reflex' | 'executive' | 'cortex';

export interface CFGLRouteResult {
  route: CFGLEntry;
  confidence: number;
  importance: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

// ─── CFGL Rule definitions ───────────────────────────────────────────

interface CFGLRule {
  sourcePattern: string | RegExp;
  typePattern: string | RegExp;
  route: CFGLEntry;
  reason: string;
}

const DEFAULT_CFGL_RULES: CFGLRule[] = [
  { sourcePattern: 'nfc', typePattern: 'nfc_tap', route: 'reflex', reason: 'known_nfc_shape' },
  { sourcePattern: 'webhook', typePattern: /webhook|hook/, route: 'reflex', reason: 'known_webhook_shape' },
  { sourcePattern: /serial|lora|esp32/, typePattern: /sensor|telemetry/, route: 'reflex', reason: 'known_iot_shape' },
  { sourcePattern: 'document_upload', typePattern: 'document', route: 'executive', reason: 'document_upload' },
  { sourcePattern: 'a2a', typePattern: 'a2a_task', route: 'executive', reason: 'a2a_delegation' },
  { sourcePattern: /ingestion|transcription/, typePattern: /ingestion|chunk/, route: 'executive', reason: 'ingestion_requires_context' },
  { sourcePattern: /critical|alert/, typePattern: /.*/, route: 'cortex', reason: 'critical_importance' },
  { sourcePattern: /.*/, typePattern: /policy|conflict/, route: 'cortex', reason: 'policy_context_required' },
];

// ─── SubconsciousObserver ────────────────────────────────────────────

export class SubconsciousObserver {
  private cfglRules: CFGLRule[];

  constructor(private memory: MemoryStore, private graph: GraphStore) {
    this.cfglRules = [...DEFAULT_CFGL_RULES];
  }

  observeMemory(from: number = 0, to: number = Infinity): ReadonlyArray<Readonly<MemoryEntry>> {
    return this.memory.readRange(from, to);
  }

  observeGraph(nodeId: string, depth: number = 3): ReturnType<GraphStore['traverse']> {
    return this.graph.traverse(nodeId, depth);
  }

  patternDensity(nodeId: string): number {
    const result = this.graph.traverse(nodeId, 3);
    return result.edges.length / Math.max(result.nodes.length, 1);
  }

  /**
   * CFGL routing: classify an atom's source+type into a tier.
   * This is the "subconscious filter" — no LLM, pure rule matching.
   * Returns route, confidence, importance, and reason.
   */
  routeAtom(atom: { source: string; type: string; confidence?: number; importance?: string }): CFGLRouteResult {
    const confidence = atom.confidence ?? 0.5;
    const importance = atom.importance ?? 'medium';

    // Match against CFGL rules
    for (const rule of this.cfglRules) {
      const sourceMatch = typeof rule.sourcePattern === 'string'
        ? atom.source === rule.sourcePattern || atom.source.includes(rule.sourcePattern)
        : rule.sourcePattern.test(atom.source);
      const typeMatch = typeof rule.typePattern === 'string'
        ? atom.type === rule.typePattern || atom.type.includes(rule.typePattern)
        : rule.typePattern.test(atom.type);

      if (sourceMatch && typeMatch) {
        return {
          route: rule.route,
          confidence,
          importance: importance as CFGLRouteResult['importance'],
          reason: rule.reason,
        };
      }
    }

    // Default: executive (requires Mellum2 evaluation)
    return {
      route: 'executive',
      confidence,
      importance: importance as CFGLRouteResult['importance'],
      reason: 'unknown_shape',
    };
  }

  /**
   * Add a custom CFGL rule at runtime.
   */
  addCFGLRule(rule: CFGLRule): void {
    this.cfglRules.unshift(rule); // Prepend: custom rules take priority
  }

  write(): never { throw new WriteDeniedError('write'); }
  decide(): never { throw new WriteDeniedError('decide'); }
  execute(): never { throw new WriteDeniedError('execute'); }
}
