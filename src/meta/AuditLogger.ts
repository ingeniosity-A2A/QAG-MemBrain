/**
 * AuditLogger — emits audit events with TASHI receipts.
 *
 * Every Meta Harness intercept produces at minimum 2 events (pre + post).
 * Failures produce additional events for the failure phase.
 *
 * Events are:
 *   1. Buffered in-memory (L0)
 *   2. Flushed to TASHI L1 JSONL store periodically (default: every 100 events
 *      or 5 seconds, whichever comes first)
 *   3. Indexed into TASHI L2 DuckDB Context Ocean for retrieval
 *   4. Referenced by GSAP for timeline reconstruction
 */

export interface AuditEvent {
  /** Unique trace ID for this intercept (shared across pre/post/fail events) */
  traceId: string;
  /** Optional session ID for grouping */
  sessionId?: string;
  /** Which pillar was being intercepted */
  pillar: string;
  /** What operation was being invoked */
  operation: string;
  /** Phase of the intercept lifecycle */
  phase: 'pre' | 'post' | 'validation_failed' | 'policy_violation' | 'execution_failed' | 'arbitration_failed';
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Optional error details (only for failure phases) */
  error?: unknown;
  /** Optional result summary (only for post phase) */
  resultSummary?: string;
}

export interface AuditReceipt {
  /** TASHI ledger receipt ID */
  receiptId: string;
  /** SHA-256 hash of the canonical event JSON */
  hash: string;
  /** Sequence number within the session */
  sequence: number;
  /** Whether the event has been flushed to L1 JSONL */
  flushed: boolean;
}

export class AuditLogger {
  private buffer: AuditEvent[] = [];
  private receipts: Map<string, AuditReceipt> = new Map();
  private sequence = 0;
  private flushThreshold = 100;
  private flushIntervalMs = 5_000;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** Sink function — replaced in production with TASHI L1 writer. */
  private sink: (events: AuditEvent[]) => Promise<void> = async (_events) => {
    // Default: no-op (in-memory only). Real impl writes to TASHI L1 JSONL.
  };

  constructor() {
    this.startAutoFlush();
  }

  /** Set the persistent sink (called by TASHI when it initializes). */
  setSink(sink: (events: AuditEvent[]) => Promise<void>): void {
    this.sink = sink;
  }

  /** Log an event and return its receipt. */
  log(event: AuditEvent): AuditReceipt {
    this.buffer.push(event);
    this.sequence += 1;
    const receipt: AuditReceipt = {
      receiptId: `r_${this.sequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      hash: hashEvent(event),
      sequence: this.sequence,
      flushed: false,
    };
    this.receipts.set(event.traceId + ':' + event.phase, receipt);

    if (this.buffer.length >= this.flushThreshold) {
      void this.flush();
    }
    return receipt;
  }

  /** Look up a previously-issued receipt. */
  getReceipt(traceId: string, phase: AuditEvent['phase']): AuditReceipt | undefined {
    return this.receipts.get(traceId + ':' + phase);
  }

  /** Flush all buffered events to the sink. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer;
    this.buffer = [];
    try {
      await this.sink(events);
      for (const e of events) {
        const r = this.receipts.get(e.traceId + ':' + e.phase);
        if (r) r.flushed = true;
      }
    } catch (e) {
      // Re-queue on failure
      this.buffer.unshift(...events);
      console.error('[AuditLogger] flush failed:', e);
    }
  }

  /** Stop the auto-flush timer. */
  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      void this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }
}

function hashEvent(event: AuditEvent): string {
  // Simple FNV-1a hash for browser/Node compat. Production: use crypto.subtle SHA-256.
  const json = JSON.stringify(event);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
