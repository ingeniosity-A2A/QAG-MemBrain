/**
 * Forged-Ingestion-Box — canonical envelope.
 * Every console / browser / PWA starts processes by emitting this event.
 */

export type ForgedIngestSource =
  | 'text'
  | 'camera'
  | 'gallery'
  | 'document'
  | 'url'
  | 'github'
  | 'huggingface';

export type ForgedIngestSurface =
  | 'pwa'
  | 'console'
  | 'browser'
  | 'aether'
  | 'bento'
  | 'esa'
  | string;

export interface ForgedIngestProvenance {
  capturedAt: string;
  device?: string;
  sourceUri?: string;
  surface: ForgedIngestSurface;
}

export interface ForgedIngestRouting {
  lens?: boolean;
  parse?: boolean;
  curate?: boolean;
  remember?: boolean;
}

export interface ForgedIngestEvent {
  source: ForgedIngestSource;
  payload: unknown;
  intent?: string;
  provenance: ForgedIngestProvenance;
  routing: ForgedIngestRouting;
}

export function createIngestEvent(
  partial: Omit<ForgedIngestEvent, 'provenance'> & {
    provenance?: Partial<ForgedIngestProvenance>;
  },
  surface: ForgedIngestSurface = 'browser',
): ForgedIngestEvent {
  return {
    source: partial.source,
    payload: partial.payload,
    intent: partial.intent,
    routing: partial.routing ?? { lens: true, parse: true, curate: true, remember: true },
    provenance: {
      capturedAt: new Date().toISOString(),
      surface,
      ...partial.provenance,
    },
  };
}
