/**
 * App — AMOS v2.1 root component.
 *
 * Wires together:
 *   - AvaContext (session + pillar state)
 *   - Meta Harness singleton (initialized on mount)
 *   - Constellation singleton (initialized on mount)
 *   - InputOrchestrativeInterface (the user input surface)
 *
 * On mount:
 *   1. Initialize Meta Harness with default policies
 *   2. Initialize Constellation with default backends + health monitoring
 *   3. Register lifecycle hooks (ingress transform, egress audit)
 *   4. Mark AvaContext as ready
 *
 * All user actions then flow:
 *   InputOrchestrativeInterface
 *     -> metaHarness.intercept({ pillar: 'ava007', operation: 'delegate', ... })
 *     -> AVA007 executive loop
 *     -> delegates to other pillars via their own intercept() calls
 *     -> result returns through Meta Harness for audit
 *     -> TASHI receipt emitted
 */

import React, { useEffect, useState } from 'react';
import { AvaContextProvider } from './AvaContext.js';
import { InputOrchestrativeInterface } from './InputOrchestrativeInterface.js';
import { metaHarness } from '../../../src/meta/index.js';
import { constellation } from '../../../src/constellation/index.js';
import type { Policy } from '../../../src/meta/PolicyEngine.js';

export function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // 1. Load Meta Harness policies.
        // In production these come from DuckDB governance store; for now
        // we register a minimal set inline.
        const policies: Policy[] = [
          {
            id: 'reflex-local-only',
            kind: 'require_local',
            pillar: 'rev_ike',
            operation: 'reflex',
            params: {},
            reason: 'REV.IKE reflex must always run locally for sub-20ms latency',
          },
          {
            id: 'default-rate-limit',
            kind: 'rate_limit',
            params: { windowMs: 60_000, max: 100 },
            reason: 'Per-session rate limit: 100 ops / 60s default',
          },
          {
            id: 'ava007-budget-cap',
            kind: 'budget',
            pillar: 'ava007',
            operation: 'delegate',
            params: { maxCallMs: 5_000 },
            reason: 'AVA007 delegate calls must complete within 5 seconds',
          },
        ];
        metaHarness.policyEngine.load(policies);

        // 2. Register default backends with Constellation.
        constellation.backends.registerDefaults();

        // 3. Start health monitoring for all registered backends.
        for (const info of constellation.backends.list()) {
          constellation.health.startMonitoring(info.backend);
        }

        // 4. Wire AuditLogger to drain to console (TASHI L1 integration pending).
        // The default in-memory sink is fine; this is just a no-op override
        // that confirms the sink is reachable.
        metaHarness.auditLogger.setSink(async (events) => {
          for (const e of events) {
            console.log(`[audit] ${e.phase} ${e.pillar}/${e.operation} trace=${e.traceId}`);
          }
        });

        // 5. Register a lifecycle hook: log every ingress for observability.
        metaHarness.on('ingress', async (ctx) => {
          console.log('[ingress]', ctx.value);
          return ctx;
        });

        // 6. Load Constellation routing policies from PolicyStore.
        await constellation.policies.load();

        if (mounted) setReady(true);
      } catch (e) {
        if (mounted) setInitError(e instanceof Error ? e.message : String(e));
      }
    }

    init();

    return () => {
      mounted = false;
      // Cleanup on unmount
      try {
        constellation.health.stopAll();
        metaHarness.auditLogger.shutdown();
      } catch {
        // Ignore — component is unmounting
      }
    };
  }, []);

  if (initError) {
    return (
      <div style={{ padding: '24px', color: '#ff8080', fontFamily: 'monospace' }}>
        <h2>AMOS initialization failed</h2>
        <pre>{initError}</pre>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ padding: '24px', color: '#80a0ff', fontFamily: 'monospace' }}>
        <h2>Initializing AMOS v2.1...</h2>
        <ul>
          <li>Loading Meta Harness policies</li>
          <li>Registering Constellation backends</li>
          <li>Starting health monitors</li>
          <li>Loading routing policies</li>
        </ul>
      </div>
    );
  }

  return (
    <AvaContextProvider>
      <InputOrchestrativeInterface />
    </AvaContextProvider>
  );
}
