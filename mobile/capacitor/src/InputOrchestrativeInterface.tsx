/**
 * InputOrchestrativeInterface — AMOS v2.1 input orchestrator.
 *
 * Every user input flows through Meta Harness before reaching AVA007:
 *
 *   User input
 *     -> metaHarness.intercept({ pillar: 'ava007', operation: 'delegate', payload })
 *     -> if allowed: AVA007 executive loop
 *     -> if denied: surface rejection to user with reason
 *
 * This is the first place in the mobile shell where every keystroke /
 * voice command / file upload is governed.
 */

import React, { useState, useCallback } from 'react';
import { useAva } from './AvaContext.js';
import { metaHarness } from '../../../src/meta/index.js';
import type { InterceptionResult } from '../../../src/meta/Interceptor.js';
import { WebLLMEngine } from './services/WebLLMEngine.js';

export function InputOrchestrativeInterface() {
  const ava = useAva();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<InterceptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;

    setBusy(true);
    setError(null);

    try {
      // Route through Meta Harness BEFORE AVA007 sees the input.
      // pillar='ava007', operation='delegate' — every user->AVA007 action goes through here.
      const result = await metaHarness.intercept({
        pillar: 'ava007',
        operation: 'delegate',
        payload: { userInput: input },
        metadata: {
          sessionId: ava.sessionId ?? undefined,
          requireLocal: false,  // llama-server is local but uses 'cloud' backend type
          deadlineMs: 30_000,  // 30s budget (first model load takes time)
        },
        execute: async (payload) => {
          // Route through Constellation to local llama-server (Gemma 2B)
          const p = payload as { userInput: string };
          try {
            const engine = new WebLLMEngine();
            await engine.init({
              modelId: 'gemma-2b',
              contextLength: 8192,
              quantization: 'q4f16_1',
              requireLocal: false,
            });
            const result = await engine.generate(p.userInput);
            await engine.shutdown();
            return {
              acknowledged: true,
              response: result.text,
              backend: result.backend,
              modelId: result.modelId,
              latencyMs: result.latencyMs,
              tokenCount: result.tokenCount,
            };
          } catch (e) {
            return {
              acknowledged: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        },
      });

      setLastResult(result);

      if (!result.allowed && result.error) {
        // Surface the denial to the user with a human-readable reason.
        const err = result.error;
        if (err.kind === 'policy_violation') {
          setError(`Policy denied: ${err.reason}`);
        } else if (err.kind === 'validation_failed') {
          setError(`Invalid input: ${err.details.join(', ')}`);
        } else if (err.kind === 'deadline_exceeded') {
          setError(`Timed out after ${err.deadlineMs}ms`);
        } else if (err.kind === 'execution_failed') {
          setError(`Execution failed: ${err.cause}`);
        } else {
          setError(`Denied: ${JSON.stringify(err)}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [input, busy, ava.sessionId]);

  return (
    <div className="input-orchestrator">
      <h1>AVA007 AMOS</h1>
      <p>Mobile Runtime — Phase 3 + wiring</p>
      <p>Session: <code>{ava.sessionId ?? 'not started'}</code></p>
      <p>Meta Harness: <code>{ava.metaHarnessActive ? 'ACTIVE' : 'INACTIVE'}</code></p>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message to AVA007..."
          disabled={busy}
          style={{ width: '100%', padding: '12px', fontSize: '16px', marginTop: '16px' }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          style={{ marginTop: '8px', padding: '12px 24px', fontSize: '16px' }}
        >
          {busy ? 'Working...' : 'Send'}
        </button>
      </form>

      {error && (
        <div className="error" style={{
          marginTop: '16px', padding: '12px',
          background: '#3a1010', color: '#ff8080',
          borderRadius: '4px', fontFamily: 'monospace'
        }}>
          {error}
        </div>
      )}

      {lastResult && lastResult.allowed && (
        <div className="result" style={{
          marginTop: '16px', padding: '12px',
          background: '#103a10', color: '#80ff80',
          borderRadius: '4px', fontFamily: 'monospace'
        }}>
          {lastResult.result && typeof lastResult.result === 'object' && 'response' in lastResult.result ? (
            <>
              <div style={{ marginBottom: '8px', fontSize: '14px', color: '#a0ffa0' }}>
                <strong>AVA007:</strong> {(lastResult.result as { response: string }).response}
              </div>
              <div style={{ fontSize: '11px', color: '#60a060' }}>
                Backend: {(lastResult.result as { backend?: string }).backend ?? 'unknown'} |
                Model: {(lastResult.result as { modelId?: string }).modelId ?? 'unknown'} |
                Latency: {(lastResult.result as { latencyMs?: number }).latencyMs ?? 0}ms |
                Tokens: {(lastResult.result as { tokenCount?: number }).tokenCount ?? 0}
              </div>
            </>
          ) : (
            <>
              <div><strong>Allowed:</strong> yes</div>
              <div><strong>Duration:</strong> {lastResult.durationMs}ms</div>
              <div><strong>Policy:</strong> {lastResult.policyDecision.reason}</div>
              {lastResult.result !== undefined && (
                <div><strong>Result:</strong> {JSON.stringify(lastResult.result)}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
