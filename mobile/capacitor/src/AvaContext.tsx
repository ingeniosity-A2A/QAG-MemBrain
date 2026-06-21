// Placeholder — AVA007 runtime context provider
// Wraps the entire app in the AVA007 executive authority + Meta Harness
import React, { createContext, useContext, useState } from 'react';

interface AvaState {
  sessionId: string | null;
  pillar: 'ava007' | 'rev_ike' | 'fable' | 'goose' | 'tashi' | null;
  metaHarnessActive: boolean;
}

const AvaContext = createContext<AvaState | null>(null);

export function AvaContextProvider({ children }: { children: React.ReactNode }) {
  const [state] = useState<AvaState>({
    sessionId: null,
    pillar: null,
    metaHarnessActive: false,
  });
  return <AvaContext.Provider value={state}>{children}</AvaContext.Provider>;
}

export function useAva() {
  const ctx = useContext(AvaContext);
  if (!ctx) throw new Error('useAva must be used within AvaContextProvider');
  return ctx;
}
