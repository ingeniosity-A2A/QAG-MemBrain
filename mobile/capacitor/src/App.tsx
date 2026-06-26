import React, { useState, useEffect, useCallback, useRef } from 'react';
import TrainModelHeader from './components/flagship/TrainModelHeader';
import AvaChatSurface, { type ChatMessage } from './components/flagship/AvaChatSurface';
import InputConsole from './components/flagship/InputConsole';
import SocialGlassBar from './components/flagship/SocialGlassBar';
import SplitFlapBoard from './components/flagship/SplitFlapBoard';
import AtlantaWeather from './components/flagship/AtlantaWeather';
import { metaHarness } from '../../../src/meta/index.js';
import { getTemporalEngine } from '../../../src/temporal/index.js';
import { getPhoneIntegration, type PhoneState } from '../../../src/telecom/PhoneIntegration.js';

// Context Lake loaded lazily inside useEffect to prevent top-level await
let getContextLake: any = () => null;

const LLAMA_SERVER = 'http://localhost:8080';

function getTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function genTraceId() {
  return 'trc_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

export function App() {
  const [mode, setMode] = useState<'admin'|'customer'>('admin');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ava', text: 'AVA007 online. Sovereign inference active via Gemma 2B. How can I help?', time: getTime() },
  ]);
  const [busy, setBusy] = useState(false);
  const [tokensPerSec, setTokensPerSec] = useState<number | undefined>();
  const [phoneState, setPhoneState] = useState<PhoneState>('idle');
  const [stats, setStats] = useState<{ audit_events: number; inferences: number } | undefined>();

  // Refs for singletons
  const temporal = useRef(getTemporalEngine());
  const phone = useRef(getPhoneIntegration());
  const lakeInitialized = useRef(false);

  // Initialize all subsystems on mount
  useEffect(() => {
    async function init() {
      // Phase 6: GSAP Temporal Engine
      temporal.current.setSession('s_' + Date.now().toString(36));
      temporal.current.insertIntelligence('ava007.boot', { value: 'online', metadata: { time: Date.now() } });

      // Phase 4.5: Phone Integration
      phone.current.init();
      phone.current.onStateChange((state) => {
        setPhoneState(state);
        if (state === 'in_call') {
          temporal.current.insertIntelligence('phone.call_started', { value: true });
        } else if (state === 'ended') {
          temporal.current.insertIntelligence('phone.call_ended', { value: true });
        }
      });

      // Phase 5: Context Lake (DuckDB) — lazy load to prevent crash
      try {
        const mod = await import('../../../src/context_lake/index.js');
        getContextLake = mod.getContextLake;
        const lake = getContextLake();
        await lake.init();
        lakeInitialized.current = true;
        const s = await lake.getStats();
        setStats(s);
        console.log('[app] Context Lake initialized:', s);
      } catch (e) {
        console.warn('[app] Context Lake init failed (non-fatal):', e);
      }

      // Phase 8: Meta Harness policies
      const policies = [
        { id: 'rate-limit', kind: 'rate_limit' as const, params: { windowMs: 60000, max: 100 }, reason: 'Rate limit' },
        { id: 'budget', kind: 'budget' as const, pillar: 'ava007', operation: 'delegate', params: { maxCallMs: 30000 }, reason: 'Budget cap' },
      ];
      metaHarness.policyEngine.load(policies);

      // Wire audit logger to Context Lake
      metaHarness.auditLogger.setSink(async (events) => {
        for (const e of events) {
          console.log(`[audit] ${e.phase} ${e.pillar}/${e.operation}`);
          if (lakeInitialized.current) {
            try {
              const lake = getContextLake();
              await lake.storeAuditEvent({
                trace_id: e.traceId,
                session_id: e.sessionId ?? null,
                pillar: e.pillar,
                operation: e.operation,
                phase: e.phase,
                timestamp: e.timestamp,
                error: e.error ? JSON.stringify(e.error) : null,
                result_summary: e.resultSummary ?? null,
              });
            } catch {}
          }
        }
      });
    }
    init();
  }, []);

  // Phase 8: Executive Loop — the real inference path
  const handleSend = useCallback(async (text: string) => {
    // Pause if phone call is active
    if (phone.current.shouldPause()) {
      setMessages(prev => [...prev, { role: 'error', text: 'Phone call in progress. AVA007 paused to preserve call quality.', time: getTime() }]);
      return;
    }

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text, time: getTime() }]);
    setBusy(true);

    // Phase 6: insertIntelligence — record user input
    temporal.current.insertIntelligence('user.input', { text, metadata: { time: Date.now() } });

    // Add thinking indicator
    setMessages(prev => [...prev, { role: 'thinking', text: 'AVA007 is thinking...', time: getTime() }]);

    const traceId = genTraceId();
    const systemPrompt = mode === 'customer'
      ? 'You are AVA007, an AI assistant for Help Assembly, a furniture assembly service. Help customers get quotes and schedule service. Be friendly and concise.'
      : 'You are AVA007, a sovereign AI assistant on Samsung S25 Ultra via llama-server with Gemma 2B. Be direct and technical.';

    try {
      // Phase 8: Route through Meta Harness
      const result = await metaHarness.intercept({
        pillar: 'ava007',
        operation: 'delegate',
        payload: { userInput: text },
        metadata: { traceId, deadlineMs: 30000 },
        execute: async () => {
          // Direct fetch to llama-server (the real inference)
          const resp = await fetch(`${LLAMA_SERVER}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text },
              ],
              max_tokens: 512,
              temperature: 0.7,
            }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return await resp.json();
        },
      });

      if (!result.allowed) {
        throw new Error(result.error?.kind ?? 'Policy denied');
      }

      const data = result.result as any;
      const reply = data.choices[0].message.content;

      // Update tokens/sec
      if (data.timings?.predicted_per_second) {
        setTokensPerSec(data.timings.predicted_per_second);
      }

      // Remove thinking, add response
      setMessages(prev => [
        ...prev.filter(m => m.role !== 'thinking'),
        { role: 'ava', text: reply, time: getTime() },
      ]);

      // Phase 6: insertIntelligence — record AVA007 response
      temporal.current.insertIntelligence('ava007.response', { text: reply, metadata: { traceId, tokens: data.usage?.completion_tokens } });

      // Phase 5: Store in Context Lake
      if (lakeInitialized.current) {
        try {
          const lake = getContextLake();
          await lake.storeInference({
            trace_id: traceId,
            prompt: text,
            response: reply,
            model_id: data.model ?? 'gemma-2b',
            backend: 'llama-server',
            latency_ms: data.timings?.predicted_ms ?? 0,
            token_count: data.usage?.completion_tokens ?? 0,
            tokens_per_sec: data.timings?.predicted_per_second ?? 0,
            timestamp: new Date().toISOString(),
          });
          const s = await lake.getStats();
          setStats(s);
        } catch (e) {
          console.warn('[app] Context Lake store failed:', e);
        }
      }
    } catch (e) {
      setMessages(prev => [
        ...prev.filter(m => m.role !== 'thinking'),
        { role: 'error', text: `Error: ${e instanceof Error ? e.message : String(e)}. Is llama-server running on port 8080?`, time: getTime() },
      ]);
    } finally {
      setBusy(false);
    }
  }, [mode]);

  return (
    <div style={{
      background: '#e8eaf0', color: '#3a3a4a',
      fontFamily: '-apple-system, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
      fontSize: '15px', height: '100vh', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* HEADER */}
      <div style={{
        padding: '14px 20px', background: '#eef0f5',
        borderRadius: '0 0 16px 16px',
        boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#3a3a4a' }}>AVA007</div>
          <div style={{
            fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em',
            color: busy ? '#d4a72c' : phoneState !== 'idle' ? '#e64545' : '#4caf50',
            padding: '3px 10px', borderRadius: '999px', background: '#eef0f5',
            boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
          }}>
            {phoneState !== 'idle' ? `PHONE: ${phoneState.toUpperCase()}` : busy ? 'THINKING' : 'LIVE'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AtlantaWeather />
          <SocialGlassBar mode={mode} onModeChange={setMode} />
        </div>
      </div>

      {/* SPLIT FLAP */}
      <div style={{ padding: '8px 16px', flexShrink: 0 }}>
        <SplitFlapBoard text={tokensPerSec ? `${tokensPerSec.toFixed(1)} TOK/S` : 'GEMMA 2B'} />
      </div>

      {/* CHAT */}
      <AvaChatSurface messages={messages} />

      {/* ADMIN INFO BAR */}
      {mode === 'admin' && (
        <div style={{
          padding: '6px 16px', background: '#eef0f5',
          boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
          fontSize: '10px', color: '#8a8a9a', textAlign: 'center', flexShrink: 0,
        }}>
          Model: Gemma 2B | Endpoint: localhost:8080 | Mode: {mode}
          {tokensPerSec && ` | ${tokensPerSec.toFixed(1)} tok/s`}
          {stats && ` | Memory: ${stats.inferences} inferences, ${stats.audit_events} events`}
          {phoneState !== 'idle' && ` | Phone: ${phoneState}`}
        </div>
      )}

      {/* CUSTOMER QUOTE CARD */}
      {mode === 'customer' && (
        <div style={{
          margin: '8px 16px', padding: '20px', background: '#eef0f5',
          borderRadius: '16px',
          boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: '#8a8a9a' }}>Service Quote</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#d4a72c' }}>$146</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#eef0f5', borderRadius: '10px', boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)', fontSize: '13px' }}>
              <span style={{ color: '#3a3a4a' }}>Assembly Service</span>
              <span style={{ color: '#d4a72c', fontWeight: 600 }}>$146</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: 'rgba(212,167,44,0.12)', color: '#d4a72c', boxShadow: 'inset -2px -2px 6px rgba(255,255,255,0.6), inset 3px 3px 8px rgba(212,167,44,0.3)' }}>Accept</button>
            <button style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: '#eef0f5', color: '#8a8a9a', boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)' }}>Decline</button>
          </div>
        </div>
      )}

      {/* INPUT */}
      <InputConsole onSend={handleSend} disabled={busy || phoneState !== 'idle'} />
    </div>
  );
}
