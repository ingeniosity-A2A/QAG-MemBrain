import React, { useState, useCallback } from 'react';
import TrainModelHeader from './components/flagship/TrainModelHeader';
import AvaChatSurface, { type ChatMessage } from './components/flagship/AvaChatSurface';
import InputConsole from './components/flagship/InputConsole';
import SocialGlassBar from './components/flagship/SocialGlassBar';
import SplitFlapBoard from './components/flagship/SplitFlapBoard';
import AtlantaWeather from './components/flagship/AtlantaWeather';

const LLAMA_SERVER = 'http://localhost:8080';

function getTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

export function App() {
  const [mode, setMode] = useState<'admin'|'customer'>('admin');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ava', text: 'AVA007 online. Sovereign inference active via Gemma 2B. How can I help?', time: getTime() },
  ]);
  const [busy, setBusy] = useState(false);
  const [tokensPerSec, setTokensPerSec] = useState<number | undefined>();

  const handleSend = useCallback(async (text: string) => {
    // Add user message
    setMessages(prev => [...prev, { role: 'user', text, time: getTime() }]);
    setBusy(true);

    // Add thinking indicator
    setMessages(prev => [...prev, { role: 'thinking', text: 'AVA007 is thinking...', time: getTime() }]);

    const systemPrompt = mode === 'customer'
      ? 'You are AVA007, an AI assistant for Help Assembly, a furniture assembly service. Help customers get quotes and schedule service. Be friendly and concise.'
      : 'You are AVA007, a sovereign AI assistant on Samsung S25 Ultra via llama-server with Gemma 2B. Be direct and technical.';

    try {
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
      const data = await resp.json();
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
      background: '#e8eaf0',
      color: '#3a3a4a',
      fontFamily: '-apple-system, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
      fontSize: '15px',
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* HEADER with mode toggle + weather */}
      <div style={{
        padding: '14px 20px',
        background: '#eef0f5',
        borderRadius: '0 0 16px 16px',
        boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', color: '#3a3a4a' }}>
            AVA007
          </div>
          <div style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: busy ? '#d4a72c' : '#4caf50',
            padding: '3px 10px',
            borderRadius: '999px',
            background: '#eef0f5',
            boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
          }}>
            {busy ? 'THINKING' : 'LIVE'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AtlantaWeather />
          <SocialGlassBar mode={mode} onModeChange={setMode} />
        </div>
      </div>

      {/* SPLIT FLAP BOARD (shows model info) */}
      <div style={{ padding: '8px 16px', flexShrink: 0 }}>
        <SplitFlapBoard text={tokensPerSec ? `${tokensPerSec.toFixed(1)} TOK/S` : 'GEMMA 2B'} />
      </div>

      {/* CHAT AREA */}
      <AvaChatSurface messages={messages} />

      {/* ADMIN INFO BAR */}
      {mode === 'admin' && (
        <div style={{
          padding: '6px 16px',
          background: '#eef0f5',
          boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
          fontSize: '10px',
          color: '#8a8a9a',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          Model: Gemma 2B | Endpoint: localhost:8080 | Mode: {mode}
          {tokensPerSec && ` | ${tokensPerSec.toFixed(1)} tok/s`}
        </div>
      )}

      {/* CUSTOMER QUOTE CARD */}
      {mode === 'customer' && (
        <div style={{
          margin: '8px 16px',
          padding: '20px',
          background: '#eef0f5',
          borderRadius: '16px',
          boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8a8a9a' }}>
              Service Quote
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#d4a72c' }}>$146</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '8px 12px', background: '#eef0f5', borderRadius: '10px',
              boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
              fontSize: '13px',
            }}>
              <span style={{ color: '#3a3a4a' }}>Assembly Service</span>
              <span style={{ color: '#d4a72c', fontWeight: 600 }}>$146</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{
              flex: 1, padding: '10px', border: 'none', borderRadius: '10px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              background: 'rgba(212,167,44,0.12)', color: '#d4a72c',
              boxShadow: 'inset -2px -2px 6px rgba(255,255,255,0.6), inset 3px 3px 8px rgba(212,167,44,0.3)',
            }}>
              Accept
            </button>
            <button style={{
              flex: 1, padding: '10px', border: 'none', borderRadius: '10px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              background: '#eef0f5', color: '#8a8a9a',
              boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
            }}>
              Decline
            </button>
          </div>
        </div>
      )}

      {/* INPUT */}
      <InputConsole onSend={handleSend} disabled={busy} />
    </div>
  );
}
