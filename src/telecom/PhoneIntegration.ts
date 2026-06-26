/**
 * PhoneIntegration — coexists with the phone stack.
 *
 * Phase 4.5 — Phone integration.
 *
 * Per AMOS v2.8 §10: Phone calls = income. AVA007 must coexist with
 * the phone stack, not compete with it.
 *
 * In the browser, we use the Web Telephony API (if available) or
 * listen for audio focus changes. On Capacitor (native), we'd use
 * @capacitor-community/telephony or a custom plugin.
 *
 * For now (browser-only path), we detect call-like events via:
 * 1. Audio focus changes (MediaSession API)
 * 2. Page visibility changes (phone app takes foreground)
 * 3. WebRTC audio track interruptions
 *
 * When a call is detected:
 * - AVA007 pauses inference (yields CPU/GPU to phone stack)
 * - Meta Harness continues auditing but queues new requests
 * - After call ends, AVA007 resumes
 */

export type PhoneState = 'idle' | 'ringing' | 'in_call' | 'ended';

export interface PhoneEvent {
  state: PhoneState;
  timestamp: number;
  duration_ms?: number;
}

type PhoneStateListener = (state: PhoneState, event: PhoneEvent) => void;

class PhoneIntegrationManager {
  private currentState: PhoneState = 'idle';
  private listeners: Set<PhoneStateListener> = new Set();
  private callStartTime: number | null = null;
  private lastVisibilityState: string = 'visible';

  /**
   * Initialize phone integration. Call this on app startup.
   */
  init(): void {
    // 1. Monitor page visibility (phone app takes foreground during calls)
    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange(document.visibilityState);
    });

    // 2. Monitor MediaSession (some browsers fire this during calls)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('pause', () => {
        this.setState('in_call');
      });
    }

    // 3. Monitor audio interruptions (AudioContext state changes)
    // When a call comes in, the browser may suspend audio contexts
    try {
      const audioCtx = new AudioContext();
      audioCtx.addEventListener('statechange', () => {
        if (audioCtx.state === 'suspended' && this.currentState === 'idle') {
          // Audio was suspended — might be a call
          this.setState('ringing');
        } else if (audioCtx.state === 'running' && this.currentState === 'in_call') {
          // Audio resumed — call might have ended
          this.setState('ended');
          setTimeout(() => this.setState('idle'), 2000);
        }
      });
    } catch {
      // AudioContext not available — skip this detection method
    }

    console.log('[phone] Phone integration initialized — AVA007 will yield during calls');
  }

  /**
   * Register a listener for phone state changes.
   */
  onStateChange(listener: PhoneStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current phone state.
   */
  getState(): PhoneState {
    return this.currentState;
  }

  /**
   * Check if AVA007 should pause (phone is active).
   */
  shouldPause(): boolean {
    return this.currentState === 'ringing' || this.currentState === 'in_call';
  }

  /**
   * Manually set phone state (for testing or native plugin integration).
   */
  setState(state: PhoneState): void {
    if (state === this.currentState) return;

    const event: PhoneEvent = {
      state,
      timestamp: Date.now(),
    };

    // Track call duration
    if (state === 'in_call' && this.callStartTime === null) {
      this.callStartTime = Date.now();
    } else if (state === 'ended' && this.callStartTime !== null) {
      event.duration_ms = Date.now() - this.callStartTime;
      this.callStartTime = null;
    }

    const oldState = this.currentState;
    this.currentState = state;

    console.log(`[phone] State: ${oldState} → ${state}${event.duration_ms ? ` (${event.duration_ms}ms)` : ''}`);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(state, event);
      } catch (e) {
        console.error('[phone] Listener error:', e);
      }
    }
  }

  private handleVisibilityState(visibilityState: string): void {
    this.lastVisibilityState = visibilityState;
    // If page becomes hidden, might be a call or app switch
    // We don't set 'in_call' directly — too many false positives
    // But if we were in 'ringing' and page hides, likely answered
    if (visibilityState === 'hidden' && this.currentState === 'ringing') {
      this.setState('in_call');
    } else if (visibilityState === 'visible' && this.currentState === 'in_call') {
      // Page came back — call might have ended
      this.setState('ended');
      setTimeout(() => this.setState('idle'), 2000);
    }
  }

  private handleVisibilityChange(visibilityState: string): void {
    this.handleVisibilityState(visibilityState);
  }
}

/** Singleton instance. */
let _instance: PhoneIntegrationManager | null = null;

export function getPhoneIntegration(): PhoneIntegrationManager {
  if (!_instance) {
    _instance = new PhoneIntegrationManager();
  }
  return _instance;
}
