import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Brain } from '../brain/index.js';
import { type TimelineEntry } from '../temporal/index.js';

export interface WSServerConfig { port: number; brain: Brain; }

export class MemBrainWSServer {
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private timelineWss: WebSocketServer;
  private brain: Brain;

  constructor(config: WSServerConfig) {
    this.brain = config.brain;
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
        const decision = this.brain.process(msg);
        ws.send(JSON.stringify({ type: 'decision', data: decision }));
      } catch (err: any) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
    });
  }

  private _handleTimelineConnection(ws: WebSocket): void {
    const timeline = this.brain.temporal.replay();
    ws.send(JSON.stringify({ type: 'timeline_snapshot', entries: timeline }));
  }

  private _handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', seq: this.brain.memory.seq })); }
    else { res.writeHead(404); res.end('Not found'); }
  }
}
