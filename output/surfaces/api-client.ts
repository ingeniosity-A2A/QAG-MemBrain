/**
 * Surface API Client
 * Connects to QAG_MemBrain core via WebSocket /timeline and REST endpoints.
 * Surface layer is read-only - never writes directly to memory or consensus.
 */
export interface SurfaceClient {
  sendPrompt(prompt: string): Promise<void>;
  onAgentMessage(cb: (msg: string) => void): () => void;
  onTimelineEntry(cb: (entry: any) => void): () => void;
  queryMemory(filter: { type?: string; limit?: number }): Promise<any[]>;
  getHealth(): Promise<{ status: string; seq: number }>;
  close(): void;
}

export function createSurfaceClient(
  wsUrl: string = 'ws://localhost:8080/timeline',
  httpUrl: string = 'http://localhost:8080',
): SurfaceClient {
  let ws: WebSocket | null = null;
  const agentCallbacks: ((msg: string) => void)[] = [];
  const timelineCallbacks: ((entry: any) => void)[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Surface] Connected to MemBrain core');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'decision' && data.data) {
          const content = data.data.rationale || data.data.action || JSON.stringify(data.data);
          agentCallbacks.forEach((cb) => cb(content));
        }
        if (data.type === 'timeline_snapshot' || data.entries) {
          const entries = data.entries || [data];
          entries.forEach((entry: any) => timelineCallbacks.forEach((cb) => cb(entry)));
        }
      } catch {}
    };

    ws.onclose = () => {
      console.log('[Surface] Disconnected, reconnecting in 3s...');
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[Surface] WebSocket error', err);
    };
  }

  connect();

  async function sendPrompt(prompt: string): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return sendPrompt(prompt);
    }
    ws.send(JSON.stringify(prompt));
  }

  function onAgentMessage(cb: (msg: string) => void): () => void {
    agentCallbacks.push(cb);
    return () => {
      const idx = agentCallbacks.indexOf(cb);
      if (idx !== -1) agentCallbacks.splice(idx, 1);
    };
  }

  function onTimelineEntry(cb: (entry: any) => void): () => void {
    timelineCallbacks.push(cb);
    return () => {
      const idx = timelineCallbacks.indexOf(cb);
      if (idx !== -1) timelineCallbacks.splice(idx, 1);
    };
  }

  async function queryMemory(filter: { type?: string; limit?: number } = {}): Promise<any[]> {
    try {
      const response = await fetch(`${httpUrl}/memory/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filter),
      });
      return response.json();
    } catch {
      return [];
    }
  }

  async function getHealth(): Promise<{ status: string; seq: number }> {
    try {
      const response = await fetch(`${httpUrl}/health`);
      return response.json();
    } catch {
      return { status: 'disconnected', seq: 0 };
    }
  }

  function close() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  }

  return { sendPrompt, onAgentMessage, onTimelineEntry, queryMemory, getHealth, close };
}
