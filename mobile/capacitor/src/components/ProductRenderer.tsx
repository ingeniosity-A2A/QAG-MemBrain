'use client';

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// ═══ Ava's Voice — sourced from Ava007 repo (runtime/lib/voice/speak.ts) ═══
const spoken = new Set<string>();

function pickFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => /zira|samantha|karen|victoria|fiona|female|woman/i.test(v.name) && v.lang.startsWith("en")) ??
    voices.find(v => v.lang.startsWith("en")) ??
    null
  );
}

function avaSpeak(text: string, opts: { rate?: number; pitch?: number; onStart?: () => void; onEnd?: () => void } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) { opts.onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 0.95;
  u.pitch = opts.pitch ?? 1.1;
  u.volume = 1.0;
  const voice = pickFemaleVoice();
  if (voice) u.voice = voice;
  if (opts.onStart) u.onstart = opts.onStart;
  if (opts.onEnd) { u.onend = opts.onEnd; u.onerror = opts.onEnd; }
  window.speechSynthesis.speak(u);
}

function avaSay(event: { type: string; [key: string]: any }) {
  const utterances: Record<string, { text: string; rate: number; pitch: number }> = {
    greeting:     { text: "AVA007 online. Ready when you are.", rate: 0.95, pitch: 1.1 },
    product:      { text: `Analyzing ${event.name || "product"}. ${event.category || ""}, ${event.complexity || ""} complexity.`, rate: 1.0, pitch: 1.1 },
    model_loaded: { text: "3D model loaded. Drag to rotate.", rate: 0.95, pitch: 1.0 },
    quote:        { text: `Quote generated. ${event.hours || 2.5} hours, 2 technicians needed.`, rate: 1.0, pitch: 1.05 },
    dispatched:   { text: "Technician dispatched. ETA 25 minutes.", rate: 1.05, pitch: 1.1 },
    uploaded:     { text: "Image received. Analyzing now.", rate: 0.95, pitch: 1.1 },
  };
  const u = utterances[event.type] || utterances.greeting;
  avaSpeak(u.text, { rate: u.rate, pitch: u.pitch });
}

// ═══ Theme ═══
const T = {
  accent: "#d4a043",
  green: "#29c676",
  white: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.32)",
  dim: "rgba(255,255,255,0.10)",
  border: "rgba(255,255,255,0.07)",
  card: "rgba(255,255,255,0.07)",
  metal: "#a8a8a8",
};

// ═══ Product Analysis (calls AVA007 Mercury 2 or Agent-X harness) ═══
async function analyzeProduct(b64: string, mtype: string) {
  // In production: call Agent-X harness.process() or Mercury 2 directly
  // For now: return a realistic product analysis
  return {
    productName: "Shell Lounge Chair",
    nameWords: ["Shell", "Lounge", "Chair"],
    highlightIndex: 1,
    modelCode: "SLC-04",
    variant: "Walnut / Boucle",
    material: "Walnut Wood · Boucle Fabric",
    width: 78, depth: 76, height: 72,
    dimensionUnit: "cm",
    category: "Lounge Chair",
    complexity: "Medium",
    assemblyHours: 2.5,
    pieces: 24,
  };
}

// ═══ 3D Model Loader ═══
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} scale={1.5} position={[0, -1, 0]} />;
}

// ═══ Metal Stepper Wheel ═══
function MetalStepperWheel({ items, current, onChange }: {
  items: any[];
  current: number;
  onChange: (idx: number) => void;
}) {
  const N = items.length;
  const VISIBLE = Math.min(N, 14);
  const half = Math.floor(VISIBLE / 2);

  const bars = Array.from({ length: VISIBLE }, (_, slot) => {
    const idx = current - half + slot;
    const dist = Math.abs(slot - half);
    const t = dist / half;
    const scaleX = Math.cos(t * (Math.PI / 2)) * 0.85 + 0.15;
    const active = idx === current;
    return { idx, active, valid: idx >= 0 && idx < N, scaleX };
  });

  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: "3.8rem",
      display: "flex", flexDirection: "column", alignItems: "flex-end",
      padding: "2rem 0.8rem", zIndex: 10,
    }}>
      {bars.map(({ idx, active, valid, scaleX }, i) => (
        <div
          key={i}
          onClick={() => valid && onChange(idx)}
          style={{
            width: active ? "1.6rem" : "1.1rem",
            height: active ? "5px" : "2.5px",
            background: active
              ? `linear-gradient(90deg, #ddd, ${T.metal}, #ddd)`
              : "#555",
            margin: "6px 0",
            borderRadius: "3px",
            boxShadow: active
              ? `0 0 10px ${T.green}, inset 0 2px 3px rgba(255,255,255,0.7)`
              : "inset 0 1px 2px rgba(0,0,0,0.8)",
            transform: `scaleX(${scaleX})`,
            transition: "all 0.2s ease",
            cursor: valid ? "pointer" : "default",
          }}
        />
      ))}
    </div>
  );
}

// ═══ AVA Voice Indicator ═══
function AvaIndicator({ active }: { active: boolean }) {
  return (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
      display: active ? "flex" : "none", alignItems: "center", gap: 8,
      padding: "8px 16px", borderRadius: 20,
      background: "rgba(255,255,255,0.08)", backdropFilter: "blur(20px)",
      zIndex: 1000, transition: "opacity 0.3s",
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%", background: T.green,
        animation: "pulse 1s ease-in-out infinite",
      }} />
      <span style={{ color: T.muted, fontSize: 12, fontWeight: 500, letterSpacing: 1 }}>AVA</span>
      <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}`}</style>
    </div>
  );
}

// ═══ Main ProductRenderer Component ═══
export default function ProductRenderer() {
  const [items, setItems] = useState<any[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [avaActive, setAvaActive] = useState(false);
  const [quoteGenerated, setQuoteGenerated] = useState(false);

  const cur = items[current];
  const unifiedInputRef = useRef<HTMLInputElement>(null);

  // Ava speaks on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      avaSay({ type: "greeting" });
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const processFile = useCallback(async (file: File) => {
    const id = Date.now();
    const imageUrl = URL.createObjectURL(file);
    setItems(prev => [...prev, { id, imageUrl, loading: true }]);
    setCurrent(items.length);
    setQuoteGenerated(false);

    // 🔊 AVA SPEAKS: Upload received
    avaSay({ type: "uploaded" });

    try {
      const data = await analyzeProduct("", file.type);
      setItems(prev => prev.map(it =>
        it.id === id
          ? { ...it, loading: false, data, modelUrl: "https://example.com/shell-chair.glb" }
          : it
      ));

      // 🔊 AVA SPEAKS: Product analyzed
      setTimeout(() => {
        avaSay({ type: "product", name: data.productName, category: data.category, complexity: data.complexity });
      }, 500);

      // 🔊 AVA SPEAKS: Model loaded
      setTimeout(() => {
        avaSay({ type: "model_loaded" });
      }, 2000);

    } catch (e) {
      console.error(e);
    }
  }, [items.length]);

  const handleQuote = useCallback(() => {
    if (quoteGenerated) return;
    setQuoteGenerated(true);
    // 🔊 AVA SPEAKS: Quote generated
    avaSay({ type: "quote", hours: cur?.data?.assemblyHours || 2.5 });
  }, [quoteGenerated, cur]);

  const handleDispatch = useCallback(() => {
    // 🔊 AVA SPEAKS: Dispatched
    avaSay({ type: "dispatched" });
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: "black", color: "white",
      fontFamily: "system-ui", display: "flex", flexDirection: "column",
      alignItems: "center", padding: "2rem 1rem",
    }}>
      <AvaIndicator active={avaActive} />

      <div style={{
        width: "min(58rem, 97vw)", background: T.card, borderRadius: "3rem",
        border: `1px solid ${T.border}`, overflow: "hidden",
        position: "relative", padding: "2.5rem",
      }}>
        {!items.length ? (
          <div
            onClick={() => unifiedInputRef.current?.click()}
            style={{
              height: "420px", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              border: `2px dashed ${T.muted}`, borderRadius: "2rem", cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>📤</div>
            <div style={{ fontSize: "1.2rem" }}>Upload Image, PDF, or Text</div>
            <div style={{ fontSize: "0.8rem", color: T.muted, marginTop: "0.5rem" }}>
              Ava will analyze and generate a quote
            </div>
            <input
              ref={unifiedInputRef}
              type="file"
              accept="image/*,application/pdf,text/*"
              hidden
              onChange={e => e.target.files?.[0] && processFile(e.target.files[0])}
            />
          </div>
        ) : (
          <div style={{ display: "flex", gap: "2rem" }}>
            {/* Left Metadata */}
            <div style={{ width: "240px" }}>
              <div style={{ fontSize: "0.8rem", color: T.muted, marginBottom: "1rem" }}>
                CUSTOMER UPLOADED ITEM
              </div>
              {cur?.data && (
                <>
                  <h1 style={{ fontSize: "2.2rem", lineHeight: 1.1, marginBottom: "0.5rem" }}>
                    {cur.data.nameWords?.map((w: string, i: number) => (
                      <span key={i} style={i === cur.data.highlightIndex ? { color: T.accent } : {}}>
                        {w}{" "}
                      </span>
                    ))}
                  </h1>
                  <div style={{ color: T.muted, marginBottom: "1.5rem" }}>
                    Model {cur.data.modelCode} · {cur.data.variant}
                  </div>
                  <div style={{ color: T.green, display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{
                      width: 9, height: 9, background: T.green, borderRadius: "50%",
                      boxShadow: `0 0 8px ${T.green}`,
                    }} />
                    Same Day Service
                  </div>

                  {/* Dispatch Button */}
                  <button
                    onClick={handleDispatch}
                    style={{
                      marginTop: "1.5rem", width: "100%", padding: "0.8rem",
                      background: T.green, color: "black", border: "none",
                      borderRadius: "0.8rem", fontSize: "0.9rem", fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    DISPATCH TECH →
                  </button>
                </>
              )}
            </div>

            {/* 3D Viewer */}
            <div style={{
              flex: 1, height: "380px", borderRadius: "1.5rem",
              overflow: "hidden", background: "#111", position: "relative",
            }}>
              {cur?.modelUrl ? (
                <Canvas camera={{ position: [5, 4, 8], fov: 40 }}>
                  <ambientLight intensity={0.5} />
                  <directionalLight position={[10, 10, 5]} intensity={1} />
                  <Suspense fallback={null}>
                    <Model url={cur.modelUrl} />
                  </Suspense>
                  <Environment preset="studio" />
                  <OrbitControls enablePan={false} minDistance={3} maxDistance={15} />
                </Canvas>
              ) : (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  height: "100%", color: T.muted,
                }}>
                  {cur?.loading ? "Analyzing..." : "No model"}
                </div>
              )}
            </div>

            <MetalStepperWheel items={items} current={current} onChange={setCurrent} />
          </div>
        )}
      </div>

      {/* 4 Info Boxes */}
      {cur?.data && (
        <>
          <div style={{
            display: "flex", gap: "1rem", marginTop: "2rem", width: "min(58rem, 97vw)",
          }}>
            <div style={{
              flex: 1, background: T.card, padding: "1.2rem",
              borderRadius: "1.5rem", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.65rem", color: T.muted }}>TECHS NEEDED</div>
              <div style={{ fontSize: "2.1rem", fontWeight: 700 }}>2</div>
            </div>
            <div style={{
              flex: 1, background: T.card, padding: "1.2rem",
              borderRadius: "1.5rem", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.65rem", color: T.muted }}>ASSEMBLY TIME</div>
              <div style={{ fontSize: "2.1rem", fontWeight: 700 }}>{cur.data.assemblyHours}h</div>
            </div>
            <div style={{
              flex: 1, background: T.card, padding: "1.2rem",
              borderRadius: "1.5rem", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.65rem", color: T.muted }}>INSTRUCTIONS</div>
              <a href="#" style={{ color: T.green }}>View Full Guide →</a>
            </div>
            <div style={{
              flex: 1, background: T.card, padding: "1.2rem",
              borderRadius: "1.5rem", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.65rem", color: T.muted }}>PRODUCT REVIEW</div>
              <div style={{ fontSize: "1.8rem", color: "#facc15" }}>★★★★☆</div>
              <div style={{ fontSize: "0.8rem", color: T.muted }}>4.8 (124)</div>
            </div>
          </div>

          {/* Generate Quote Button */}
          <button
            onClick={handleQuote}
            style={{
              marginTop: "1.5rem", padding: "1rem 3rem",
              background: quoteGenerated ? T.dim : T.accent,
              color: quoteGenerated ? T.muted : "black",
              border: "none", borderRadius: "2rem",
              fontSize: "1rem", fontWeight: 700, cursor: "pointer",
              transition: "all 0.3s",
            }}
          >
            {quoteGenerated ? "✓ QUOTE GENERATED" : "GENERATE QUOTE"}
          </button>
        </>
      )}
    </div>
  );
}
