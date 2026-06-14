/**
 * AvaSurface — Integrated Presentation Layer for the Ava-007 architecture
 * Combines ModelViewer (3D) + ChatSurface (A2A) + GSAP Temporal Substrate.
 */

import React, { useState, useCallback, useRef } from 'react';
import { ModelViewer } from './ModelViewer';
import { InputConsole } from './InputConsole';
import { SocialGlassBar } from './SocialGlassBar';
import { TrainModelHeader } from './TrainModelHeader';
import { ModelSource, AtmosphericState } from './useModelViewer';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

interface ProductInfo {
  name: string;
  price: string;
  counter: string;
}

export interface AvaSurfaceProps {
  wsUrl?: string;
  apiBaseUrl?: string;
  product?: ProductInfo;
  brand?: string;
  modelBadge?: string;
  defaultModel?: ModelSource;
  accentColor?: string;
  showDispatch?: boolean;
  showTimeline?: boolean;
  onVcardDownload?: () => void;
}

export const AvaSurface: React.FC<AvaSurfaceProps> = ({
  wsUrl = 'ws://localhost:8080/timeline',
  apiBaseUrl = 'http://localhost:8080',
  product = { name: 'Modern Accent Chair', price: '$249.00', counter: '1 / 3' },
  brand = 'Help Assembly Appless \u00b7 Ava007',
  modelBadge = 'Model: 7Ki-Q03',
  defaultModel,
  accentColor = '#e6b87e',
  showDispatch = true,
  showTimeline = false,
  onVcardDownload,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [dispatchVisible, setDispatchVisible] = useState(false);
  const [atmospheric, setAtmospheric] = useState<AtmosphericState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  React.useEffect(() => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'decision' && data.data) {
          setMessages((prev) => [...prev, { id: data.data.id, role: 'agent', content: data.data.rationale || data.data.action, timestamp: Date.now() }]);
        }
        if (data.type === 'atmospheric' && data.data) {
          setAtmospheric(data.data);
        }
      } catch {}
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [wsUrl]);

  const handlePrompt = useCallback((prompt: string) => {
    setMessages((prev) => [...prev, { id: `user_${Date.now()}`, role: 'user', content: prompt, timestamp: Date.now() }]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'prompt', content: prompt }));
    }
  }, []);

  const handleVcardDownload = useCallback(() => {
    if (onVcardDownload) { onVcardDownload(); return; }
    const vcardContent = `BEGIN:VCARD\nVERSION:4.0\nFN:Help Assembly Appless\nORG:Help Assembly\nTEL;TYPE=voice,work,cell:+14044391350\nTEL;TYPE=text,voice:404-439-1350\nDID:did:ava:help-assembly-appless\nX-A2A-BEEP:wss://a2a.ava.network/beep/help-assembly\nX-NAN-SERVICE:org.ava007.a2abeep\nX-BLECON-ID:urn:blecon:61a8e3c0-6f5e-4b2c-8a3e-1f2d4b6c7d8e\nX-FTM-RANGE:min=0.3;max=10.0\nX-MATCH-FILTER:type=capability;value=assembly\nX-VENDOR-UUID:550e8400-e29b-41d4-a716-446655440000\nX-MESHWEAVER-SEED:0x8a3f7e2c1b4d\nNOTE:AI-optimized A2A card.\nREV:20260613T140000Z\nEND:VCARD`;
    const blob = new Blob([vcardContent], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'help-assembly-appless.vcf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [onVcardDownload]);

  const handleAtmosphericChange = useCallback((state: AtmosphericState) => { setAtmospheric(state); }, []);

  const modelSource: ModelSource | undefined = defaultModel || {
    url: 'https://threejs.org/examples/models/gltf/SheenChair.glb',
    format: 'glb',
    artifactId: 'sheen_chair_default',
    cognitiveSummary: 'Modern accent chair — default product showcase model',
  };

  return (
    <>
      <div style={{ maxWidth: '520px', width: '100%', background: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(2rem) saturate(1.6)', borderRadius: '2rem', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 0 2rem rgba(0,0,0,0.8)', overflow: 'hidden', position: 'relative' }}>
        {/* Beeper Card */}
        <div onClick={handleVcardDownload} title="Save A2A Contact (vCard)" role="button" tabIndex={0} aria-label="Save A2A contact card"
          style={{ position: 'absolute', top: '1rem', right: '1.2rem', width: '44px', height: '44px', cursor: 'pointer', zIndex: 30, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 4s linear infinite' }}>
          <div style={{ width: '18px', height: '18px', background: accentColor, borderRadius: '50%', boxShadow: `0 0 8px ${accentColor}` }} />
        </div>

        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 600, background: `linear-gradient(135deg, #fff, ${accentColor})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{brand}</span>
            <div style={{ fontSize: '0.65rem', background: 'rgba(230,184,126,0.15)', padding: '0.2rem 0.7rem', borderRadius: '2rem', color: accentColor, fontFamily: 'monospace' }}>{modelBadge}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', margin: '1rem 0 0.5rem' }}>
            <div>
              <div style={{ fontSize: '1.3rem', fontWeight: 500, color: '#fff', fontFamily: '"DM Serif Display", serif' }}>{product.name}</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: accentColor }}>{product.price}</div>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(0,0,0,0.3)', padding: '0.2rem 0.5rem', borderRadius: '2rem' }}>{product.counter}</div>
          </div>
        </div>

        {/* 3D Render + Input Console */}
        <div style={{ padding: '1rem 1rem 0.5rem' }}>
          <ModelViewer modelSource={modelSource} accentColor={accentColor} showTimeline={showTimeline} gsapLabel="ava_surface_main" onAtmosphericChange={handleAtmosphericChange} config={{ alpha: true, autoRotate: true, autoRotateSpeed: 1.5, enableZoom: false, enablePan: false }} />
          <div style={{ marginTop: '0.5rem' }}>
            <InputConsole onPrompt={handlePrompt} disabled={!connected} />
          </div>
        </div>

        {/* Quote Card */}
        <div style={{ padding: '1rem 1.5rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 500, color: accentColor, fontFamily: '"DM Serif Display", serif', lineHeight: 1 }}>$2,480</div>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05rem', marginTop: '0.2rem' }}>FREE WHITE-GLOVE DELIVERY</div>
          </div>
          <button style={{ background: '#29c676', border: 'none', borderRadius: '3rem', padding: '0.7rem 1.8rem', fontWeight: 700, fontSize: '0.8rem', color: '#0a0a0a', cursor: 'pointer', boxShadow: '0 0 12px rgba(41,198,118,0.3)' }} onClick={() => showDispatch && setDispatchVisible(true)}>
            ACCEPT QUOTE
          </button>
        </div>
      </div>

      {/* Service Dispatch Overlay */}
      {showDispatch && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, opacity: dispatchVisible ? 1 : 0, pointerEvents: dispatchVisible ? 'auto' as const : 'none' as const, transition: 'opacity 0.2s' }}>
          <div style={{ background: '#1a1a1a', borderRadius: '2rem', maxWidth: '340px', width: '90%', padding: '1.5rem', border: `1px solid ${accentColor}`, textAlign: 'center' as const }}>
            <div style={{ color: accentColor, marginBottom: '0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>Service Dispatched</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', lineHeight: 1.5 }}>Technician Brian (DOH → TUN)<br />ETA 17 min · A2A handshake active</div>
            <div style={{ fontSize: '0.7rem', marginTop: '0.5rem', color: 'rgba(255,255,255,0.4)' }}>Ava007 has sent the service card (temporary, not saved).</div>
            <button style={{ marginTop: '1rem', background: accentColor, border: 'none', padding: '0.4rem 1rem', borderRadius: '2rem', cursor: 'pointer', color: '#0a0a0a', fontWeight: 600 }} onClick={() => setDispatchVisible(false)}>Close</button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
};
