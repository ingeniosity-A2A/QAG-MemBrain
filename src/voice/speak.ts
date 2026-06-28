"use client";

/**
 * Client-side idempotent speech utility.
 *
 * Key pattern: `{jobId}:{eventType}` — once spoken, the same key is suppressed
 * for the lifetime of the browser tab. This prevents repeated utterances when
 * the SSE stream reconnects or the same state event is re-emitted.
 */

const spoken = new Set<string>();

export type SpeakPayload = {
  key: string;
  text: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
};

/**
 * Pick a female en-US voice from the browser's voice list.
 * Falls back to any en-US voice, then the default voice.
 */
export function pickFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) =>
      /zira|samantha|karen|victoria|fiona|female|woman/i.test(v.name) &&
      v.lang.startsWith("en")
    ) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

export function speakOnce(payload: SpeakPayload): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  if (spoken.has(payload.key)) return;

  spoken.add(payload.key);

  const u = new SpeechSynthesisUtterance(payload.text);
  u.rate = payload.rate ?? 1.0;
  u.pitch = payload.pitch ?? 1.0;
  u.volume = payload.volume ?? 1.0;

  const voice = pickFemaleVoice();
  if (voice) u.voice = voice;

  if (payload.onStart) u.onstart = payload.onStart;
  if (payload.onEnd) { u.onend = payload.onEnd; u.onerror = payload.onEnd; }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/**
 * Speak immediately (no dedup key) — used by the Ava hologram for live responses.
 */
export function avaSpeak(
  text: string,
  opts?: { rate?: number; pitch?: number; onStart?: () => void; onEnd?: () => void }
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    opts?.onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts?.rate ?? 0.95;
  u.pitch = opts?.pitch ?? 1.1;
  u.volume = 1.0;

  const voice = pickFemaleVoice();
  if (voice) u.voice = voice;

  if (opts?.onStart) u.onstart = opts.onStart;
  if (opts?.onEnd) { u.onend = opts.onEnd; u.onerror = opts.onEnd; }

  window.speechSynthesis.speak(u);
}

/** Clear a specific key to allow re-speaking (e.g. after a new job starts). */
export function clearKey(key: string): void {
  spoken.delete(key);
}

/** Reset all spoken keys — call on new job session start. */
export function resetSpoken(): void {
  spoken.clear();
}
