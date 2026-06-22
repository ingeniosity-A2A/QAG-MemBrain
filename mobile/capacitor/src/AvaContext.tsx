/**
 * AvaContext — AMOS v2.1 runtime context provider.
 *
 * Wraps the entire app in the AVA007 executive authority. Exposes session
 * state + whether Meta Harness is active.
 *
 * Note: This context is purely for UI state. The actual Meta Harness +
 * Constellation singletons live in src/meta/index.ts and
 * src/constellation/index.ts. This context just reflects their state
 * to React components.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { metaHarness } from '../../../src/meta/index.js';
import { constellation } from '../../../src/constellation/index.js';

interface AvaState {
  sessionId: string | null;
  pillar: 'ava007' | 'rev_ike' | 'fable' | 'goose' | 'tashi' | null;
  metaHarnessActive: boolean;
  constellationBackends: number;
}

const AvaContext = createContext<AvaState | null>(null);

export function AvaContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AvaState>({
    sessionId: null,
    pillar: null,
    metaHarnessActive: false,
    constellationBackends: 0,
  });

  // Probe the singletons on mount to determine their state.
  // App.tsx is responsible for actually initializing them; this effect
  // just polls until they're ready.
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      const harnessActive = metaHarness.policyEngine.list().length > 0;
      const backendCount = constellation.backends.list().length;
      if (harnessActive && backendCount > 0) {
        if (!cancelled) {
          setState({
            sessionId: `s_${Date.now().toString(36)}`,
            pillar: 'ava007',
            metaHarnessActive: true,
            constellationBackends: backendCount,
          });
        }
        clearInterval(interval);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return <AvaContext.Provider value={state}>{children}</AvaContext.Provider>;
}

export function useAva() {
  const ctx = useContext(AvaContext);
  if (!ctx) throw new Error('useAva must be used within AvaContextProvider');
  return ctx;
}
