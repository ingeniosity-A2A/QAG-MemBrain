/**
 * Telnyx Integration — SMS & Voice Bridge for QAG-MemBrain
 *
 * Connects the Beeper card surface (404-439-1350) to the Brain's
 * coordination loop. Inbound SMS/voice become Atoms routed through
 * AgentRouter; outbound messages deliver decisions and quotes.
 */
import type { Atom } from '../../agent/ava007/coordination_types.js';
import type { Brain } from '../../agent/brain/index.js';

// ─── Configuration ──────────────────────────────────────────────────

export interface TelnyxConfig {
  apiKey: string;
  /** Telnyx messaging profile ID (required for SMS). */
  messagingProfileId?: string;
  /** Phone number in E.164 format, e.g. "+14044391350". */
  phoneNumber: string;
  /** Webhook path for Telnyx callbacks. */
  webhookPath?: string;
}

// ─── Telnyx API Types ───────────────────────────────────────────────

interface TelnyxSmsInbound {
  data: {
    event_type: 'message.received';
    id: string;
    occurred_at: string;
    payload: {
      from: { phone_number: string };
      to: { phone_number: string };
      text: string;
      messaging_profile_id?: string;
    };
  };
}

interface TelnyxCallInbound {
  data: {
    event_type: 'call.initiated' | 'call.answered' | 'call.hangup';
    id: string;
    occurred_at: string;
    payload: {
      call_control_id: string;
      from: string;
      to: string;
      direction: 'incoming' | 'outgoing';
      state: string;
    };
  };
}

type TelnyxWebhookEvent = TelnyxSmsInbound | TelnyxCallInbound;

// ─── SMS Message Record ─────────────────────────────────────────────

export interface SmsMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  /** Atom ID if this SMS was routed through the coordination loop. */
  atomId?: string;
  /** Routing result if processed by AgentRouter. */
  routingTier?: string;
}

// ─── Telnyx HTTP Client ─────────────────────────────────────────────

class TelnyxClient {
  private readonly baseUrl = 'https://api.telnyx.com/v2';
  private readonly headers: Record<string, string>;

  constructor(apiKey: string) {
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  async sendSms(to: string, text: string, from: string, messagingProfileId?: string): Promise<any> {
    const body: Record<string, any> = {
      from,
      to,
      text,
    };
    if (messagingProfileId) {
      body.messaging_profile_id = messagingProfileId;
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telnyx SMS failed (${res.status}): ${err}`);
    }
    return res.json();
  }

  async listMessages(params?: { direction?: string; page_size?: number }): Promise<any> {
    const qs = new URLSearchParams();
    if (params?.direction) qs.set('direction', params.direction);
    if (params?.page_size) qs.set('page_size', String(params.page_size));

    const res = await fetch(`${this.baseUrl}/messages?${qs.toString()}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telnyx list messages failed (${res.status}): ${err}`);
    }
    return res.json();
  }

  async answerCall(callControlId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/calls/${callControlId}/actions/answer`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telnyx answer call failed (${res.status}): ${err}`);
    }
    return res.json();
  }

  async hangupCall(callControlId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/calls/${callControlId}/actions/hangup`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telnyx hangup failed (${res.status}): ${err}`);
    }
    return res.json();
  }

  async getPhoneNumberDetails(phoneNumberId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/phone_numbers/${phoneNumberId}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telnyx get phone number failed (${res.status}): ${err}`);
    }
    return res.json();
  }

  async listPhoneNumbers(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/phone_numbers`, {
      headers: this.headers,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telnyx list phone numbers failed (${res.status}): ${err}`);
    }
    return res.json();
  }
}

// ─── Telnyx Bridge ──────────────────────────────────────────────────

export class TelnyxBridge {
  private client: TelnyxClient;
  private config: TelnyxConfig;
  private brain?: Brain;
  private messageLog: SmsMessage[] = [];

  constructor(config: TelnyxConfig) {
    this.config = config;
    this.client = new TelnyxClient(config.apiKey);
  }

  /** Wire the bridge to a Brain instance for full coordination loop routing. */
  attach(brain: Brain): void {
    this.brain = brain;
  }

  // ─── Outbound ───────────────────────────────────────────────────

  /**
   * Send an SMS from the MemBrain number.
   * Used for delivering decisions, quotes, and notifications.
   */
  async sendSms(to: string, text: string): Promise<SmsMessage> {
    const result = await this.client.sendSms(
      to,
      text,
      this.config.phoneNumber,
      this.config.messagingProfileId,
    );

    const msg: SmsMessage = {
      id: result.data?.id ?? crypto.randomUUID(),
      from: this.config.phoneNumber,
      to,
      text,
      timestamp: new Date().toISOString(),
      direction: 'outbound',
    };
    this.messageLog.push(msg);
    return msg;
  }

  // ─── Inbound Webhook Handler ────────────────────────────────────

  /**
   * Process an inbound Telnyx webhook event.
   * Call this from your HTTP server's webhook endpoint.
   *
   * SMS events are converted to Atoms and routed through the Brain's
   * AgentRouter pipeline. Voice calls are auto-answered (TTS bridge
   * is a future enhancement).
   */
  async handleWebhook(event: TelnyxWebhookEvent): Promise<SmsMessage | null> {
    const eventType = event.data.event_type;

    // ── Inbound SMS ────────────────────────────────────────────
    if (eventType === 'message.received') {
      const sms = event as TelnyxSmsInbound;
      const from = sms.data.payload.from.phone_number;
      const text = sms.data.payload.text;

      const inboundMsg: SmsMessage = {
        id: sms.data.id,
        from,
        to: sms.data.payload.to.phone_number,
        text,
        timestamp: sms.data.occurred_at,
        direction: 'inbound',
      };
      this.messageLog.push(inboundMsg);

      // Route through Brain coordination loop if attached
      if (this.brain) {
        try {
          const atom: Atom = {
            id: sms.data.id,
            type: 'observation.sms.inbound',
            source: 'telnyx',
            payload: {
              from,
              text,
              timestamp: sms.data.occurred_at,
              channel: 'sms',
            },
            confidence: 0.85,
            importance: 'medium',
            tags: ['sms', 'inbound', 'telnyx'],
          };

          const routeResult = await this.brain.routeAtom(atom);
          inboundMsg.atomId = atom.id;
          inboundMsg.routingTier = routeResult.task.isReflexRoute ? 'reflex' : 'executive';

          // Auto-reply if the router produced an actionable result
          if (routeResult.executionResult?.status === 'success' && routeResult.executionResult.output) {
            const replyText = typeof routeResult.executionResult.output === 'string'
              ? routeResult.executionResult.output
              : JSON.stringify(routeResult.executionResult.output);

            // Keep SMS replies under 160 chars for single-segment delivery
            const truncated = replyText.length > 157 ? replyText.slice(0, 157) + '...' : replyText;
            await this.sendSms(from, truncated);
          }
        } catch (err: any) {
          console.error(`[TelnyxBridge] Failed to route SMS atom: ${err.message}`);
        }
      }

      return inboundMsg;
    }

    // ── Inbound Voice Call ─────────────────────────────────────
    if (eventType === 'call.initiated') {
      const call = event as TelnyxCallInbound;
      const { call_control_id, from, direction } = call.data.payload;

      if (direction === 'incoming') {
        console.log(`[TelnyxBridge] Incoming call from ${from}`);

        // Log as observation atom
        if (this.brain) {
          const atom: Atom = {
            id: call.data.id,
            type: 'observation.voice.inbound',
            source: 'telnyx',
            payload: {
              from,
              callControlId: call_control_id,
              timestamp: call.data.occurred_at,
              channel: 'voice',
            },
            confidence: 0.9,
            importance: 'high',
            tags: ['voice', 'inbound', 'telnyx'],
          };
          this.brain.routeAtom(atom).catch((err: any) => {
            console.error(`[TelnyxBridge] Failed to route voice atom: ${err.message}`);
          });
        }

        // Auto-answer — TTS bridge to be added via CavernBridge integration
        try {
          await this.client.answerCall(call_control_id);
          console.log(`[TelnyxBridge] Call answered: ${call_control_id}`);
        } catch (err: any) {
          console.error(`[TelnyxBridge] Failed to answer call: ${err.message}`);
        }
      }
    }

    return null;
  }

  // ─── Query ─────────────────────────────────────────────────────

  /** Get recent message log (inbound + outbound). */
  getMessages(limit = 50): SmsMessage[] {
    return this.messageLog.slice(-limit);
  }

  /** List phone numbers on the Telnyx account. */
  async listPhoneNumbers(): Promise<any> {
    return this.client.listPhoneNumbers();
  }

  // ─── Express/Fastify Middleware Helper ─────────────────────────

  /**
   * Returns a function that can be used as an Express/Fastify route handler
   * for the Telnyx webhook endpoint.
   *
   * Usage (Express):
   *   app.post('/telnyx/webhook', bridge.webhookHandler());
   *
   * Usage (native http):
   *   See ws/server.ts for integration pattern
   */
  webhookHandler() {
    return async (req: { body: TelnyxWebhookEvent }, res: { sendStatus: (code: number) => void }) => {
      try {
        await this.handleWebhook(req.body);
        res.sendStatus(200);
      } catch (err: any) {
        console.error(`[TelnyxBridge] Webhook error: ${err.message}`);
        res.sendStatus(500);
      }
    };
  }
}
