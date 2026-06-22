/**
 * L6 – Strategic Query Transformation (Prefrontal Executive)
 *
 * Ava007 performs Strategic Ambiguity Triage: abstracting logistical
 * failures into metaphysical queries to bridge the Semantic Gap.
 *
 * This module extends (does not replace) the Ava007 class in ./index.ts.
 * The Ava007.decide() method remains the sole decision entry point;
 * this module provides the query transformation logic it can delegate to.
 */
import { enforceAuthority } from '@contract/enforcement.js';
import { MemoryStore } from '@memory/jsonl/index.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface StrategicTransformation {
  philosophical_query: string;
  target_themes: string[];
  original_tactical: string;
  confidence: number;
}

export interface AbstractionRule {
  pattern: RegExp;
  abstraction: string;
  theme: string;
}

// ─── Default Abstraction Rules ───────────────────────────────────────

const DEFAULT_ABSTRACTION_RULES: AbstractionRule[] = [
  {
    pattern: /\bstall(ed|ing)?\b|\bdelay(ed|ing)?\b|\bblocked?\b/i,
    abstraction: 'Overcoming apparent physical limitations, refusing delay, commanding the material world.',
    theme: 'Overcoming_Obstacles',
  },
  {
    pattern: /\bfail(ed|ing|ure)?\b|\bbroke(n)?\b|\berror\b/i,
    abstraction: 'Transforming apparent failure into creative redirection and inner certainty.',
    theme: 'Creative_Redirection',
  },
  {
    pattern: /\bmiss(ing|ed)?\b|\blost\b|\blacking?\b/i,
    abstraction: 'Recognizing that abundance flows from consciousness, not external conditions.',
    theme: 'Prosperity_Consciousness',
  },
  {
    pattern: /\bconfus(ed|ing|ion)?\b|\buncertain(ty)?\b/i,
    abstraction: 'Clarity emerges from decisive inner conviction, not external information.',
    theme: 'Inner_Clarity',
  },
  {
    pattern: /\bafraid\b|\bfear(ful)?\b|\banxi(ety|ous)\b/i,
    abstraction: 'Dissolving fear through the assumption of already being the person desired.',
    theme: 'Assumption_Principle',
  },
];

// ─── Query Transformer ───────────────────────────────────────────────

export class StrategicQueryTransformer {
  private rules: AbstractionRule[];
  private store: MemoryStore | null;

  constructor(store?: MemoryStore, customRules?: AbstractionRule[]) {
    this.rules = customRules ?? DEFAULT_ABSTRACTION_RULES;
    this.store = store ?? null;
  }

  /**
   * Translate a physical/tactical obstacle into a philosophical search string.
   * The "Prefrontal Turn" for executive control.
   *
   * Abstraction Rules:
   *   1. Strip physical nouns (brackets, screws, hardware)
   *   2. Identify core psychological block (delay, limitation, fear)
   *   3. Output Rev.Ike philosophical concepts for GraphRAG retrieval
   */
  transform(tacticalIssue: string): StrategicTransformation {
    // Enforce L6 authority — only L6 can invoke this transformation
    enforceAuthority({ sourceLayer: 6, targetLayer: 6, action: 'decide' });

    const matchedThemes: string[] = [];
    const matchedAbstractions: string[] = [];

    for (const rule of this.rules) {
      if (rule.pattern.test(tacticalIssue)) {
        matchedAbstractions.push(rule.abstraction);
        matchedThemes.push(rule.theme);
      }
    }

    // Default: if no rule matched, perform generic abstraction
    if (matchedThemes.length === 0) {
      matchedAbstractions.push(
        'Perceiving the hidden spiritual reality behind apparent circumstances.',
      );
      matchedThemes.push('Spiritual_Perception');
    }

    const transformation: StrategicTransformation = {
      philosophical_query: matchedAbstractions.join(' '),
      target_themes: matchedThemes,
      original_tactical: tacticalIssue,
      confidence: matchedThemes.length > 1 ? 0.85 : 0.7,
    };

    // Record the transformation on L1
    if (this.store) {
      this.store.append(6, 'query_transform', transformation);
    }

    return transformation;
  }

  /**
   * Add a custom abstraction rule at runtime.
   */
  addRule(rule: AbstractionRule): void {
    this.rules.push(rule);
  }

  /**
   * List current rules (for debugging/audit).
   */
  getRules(): ReadonlyArray<Readonly<AbstractionRule>> {
    return this.rules;
  }
}
