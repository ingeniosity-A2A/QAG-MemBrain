import { performance } from "node:perf_hooks";
import { MemoryChallenge, SolverResponse } from "./types.js";

export function runWeakSolver(challenges: MemoryChallenge[]): SolverResponse[] {
  return challenges.map((challenge) => {
    const start = performance.now();
    const answer = `Replay answer for ${challenge.targetAtomId}`;
    const latencyMs = performance.now() - start;

    return {
      challengeId: challenge.id,
      answer,
      latencyMs,
      accuracy: 0.45,
      authorityCorrectness: 0.35,
      provenanceDepth: 0.3,
      lineageCompleteness: 0.35,
      relationshipAccuracy: 0.4,
    };
  });
}
