import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Brain } from '../brain/index.js';
import { type TimelineEntry } from '../temporal/index.js';
import type { Atom } from '../ava007/coordination_types.js';
import type { TelnyxBridge } from '../telnyx/index.js';

export interface WSServerConfig {
  port: number;
  brain: Brain;
  /** Optional Telnyx bridge for SMS/Voice webhook handling. */
  telnyx?: TelnyxBridge;
}

export class MemBrainWSServer {
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private timelineWss: WebSocketServer;
  private brain: Brain;
  private telnyx?: TelnyxBridge;

  constructor(config: WSServerConfig) {
    this.brain = config.brain;
    this.telnyx = config.telnyx;
    this.server = createServer((req, res) => this._handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: '/' });
    this.wss.on('connection', (ws) => this._handleConnection(ws));
    this.timelineWss = new WebSocketServer({ server: this.server, path: '/timeline' });
    this.timelineWss.on('connection', (ws) => this._handleTimelineConnection(ws));
    this.server.listen(config.port, () => { console.log(`MemBrain WS server on port ${config.port}`); });
  }

  broadcast(data: unknown): void { const msg = JSON.stringify(data); for (const c of this.wss.clients) { if (c.readyState === WebSocket.OPEN) c.send(msg); } }
  broadcastTimeline(entry: TimelineEntry): void { const msg = JSON.stringify(entry); for (const c of this.timelineWss.clients) { if (c.readyState === WebSocket.OPEN) c.send(msg); } }
  close(): void { this.wss.close(); this.timelineWss.close(); this.server.close(); }

  private _handleConnection(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Check if this is a structured atom for the coordination loop
        if (msg.id && msg.type && msg.source && msg.payload) {
          const atom: Atom = {
            id: msg.id,
            type: msg.type,
            source: msg.source,
            payload: msg.payload,
            confidence: msg.confidence,
            importance: msg.importance,
            tags: msg.tags,
          };

          // Route through full Agent Router pipeline
          this.brain.routeAtom(atom).then((routeResult) => {
            ws.send(JSON.stringify({
              type: 'routing_result',
              data: {
                tier: routeResult.task.isReflexRoute ? 'reflex' : 'executive+',
                target: routeResult.task.target,
                intent: routeResult.task.intent,
                handoff: routeResult.handoffOccurred,
                artifactId: routeResult.artifactId,
                executionStatus: routeResult.executionResult?.status,
                latencyMs: routeResult.routingLatencyMs,
              },
            }));
          });
        } else {
          // Legacy path: plain message → brain.process()
          const decision = this.brain.process(msg);
          ws.send(JSON.stringify({ type: 'decision', data: decision }));
        }
      } catch (err: any) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
    });
  }

  private _handleTimelineConnection(ws: WebSocket): void {
    const timeline = this.brain.temporal.replay();
    ws.send(JSON.stringify({ type: 'timeline_snapshot', entries: timeline }));
  }

  private _handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // Telnyx webhook endpoint
    if (req.url === '/telnyx/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        if (this.telnyx) {
          try {
            const event = JSON.parse(body);
            this.telnyx.handleWebhook(event).then(() => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ received: true }));
            }).catch((err: Error) => {
              console.error(`[Telnyx] Webhook processing error: ${err.message}`);
              res.writeHead(500);
              res.end('Internal error');
            });
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        } else {
          res.writeHead(503);
          res.end('Telnyx bridge not configured');
        }
      });
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        seq: this.brain.memory.seq,
        cognition: {
          tier: this.brain.cognition.state.activeTier,
          mood: this.brain.cognition.state.atmosphere.mood,
          thermal: this.brain.cognition.state.sensors.thermalState,
          battery: this.brain.cognition.state.sensors.batteryLevel,
        },
        router: {
          activeConcurrency: this.brain.router.activeConcurrency,
          capabilities: this.brain.router.getCapabilityStatus().length,
          artifacts: this.brain.artifacts.size,
        },
      }));
    } else { res.writeHead(404); res.end('Not found'); }
  }
}
