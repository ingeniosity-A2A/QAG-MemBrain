import rules from "./rules.json";
import { ObservationProposal, PrecedentResult } from "../shared/types.js";

interface TweenCache {
  get(hash: string): unknown | null;
  set(hash: string, value: unknown): void;
}

class SimpleTweenCache implements TweenCache {
  private cache = new Map<string, unknown>();
  get(hash: string) {
    return this.cache.get(hash) ?? null;
  }
  set(hash: string, value: unknown) {
    this.cache.set(hash, value);
  }
}

export class ReflexEngine {
  private tweenCache: TweenCache = new SimpleTweenCache();

  execute(obs: ObservationProposal): PrecedentResult {
    if (obs.cachedTweenHash && this.tweenCache.get(obs.cachedTweenHash)) {
      return {
        matched: true,
        vertexHash: obs.cachedTweenHash,
        action: "tween_serve_from_cache",
        confidence: 1.0,
      };
    }

    if (obs.confidence >= 0.95 && (rules as any).highConfidenceIntentMap[obs.intent]) {
      return {
        matched: true,
        action: (rules as any).highConfidenceIntentMap[obs.intent],
        confidence: obs.confidence,
      };
    }

    return { matched: false, confidence: 0 };
  }

  cacheTween(hash: string, value: unknown): void {
    this.tweenCache.set(hash, value);
  }
}
