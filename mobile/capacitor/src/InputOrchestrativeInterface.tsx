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
          // This is where AVA007's actual executive loop would run.
          // For now we just echo the input back — the real AVA007 orchestrator
          // gets wired in here in a later phase.
          const p = payload as { userInput: string };
          return { acknowledged: true, echoed: p.userInput };
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
          <div><strong>Allowed:</strong> yes</div>
          <div><strong>Duration:</strong> {lastResult.durationMs}ms</div>
          <div><strong>Policy:</strong> {lastResult.policyDecision.reason}</div>
          {lastResult.result !== undefined && (
            <div><strong>Result:</strong> {JSON.stringify(lastResult.result)}</div>
          )}
        </div>
      )}
    </div>
  );
}
