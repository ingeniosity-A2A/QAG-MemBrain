/**
 * Cloudflare Worker entry point for QAG-MemBrain
 * Adapts the WebSocket server to Cloudflare Workers runtime
 */
export default {
  async fetch(request: Request, env: Record<string, string>, ctx: { waitUntil: (p: Promise<any>) => void }): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'qag-membrain', version: '0.1.0' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      // @ts-ignore - Cloudflare Workers specific WebSocketPair
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // @ts-ignore
      server.accept();
      server.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));

      server.addEventListener('message', (event: { data: string }) => {
        try {
          const msg = JSON.parse(event.data);
          server.send(JSON.stringify({
            type: 'decision',
            data: {
              id: crypto.randomUUID(),
              ts: new Date().toISOString(),
              input: msg,
              rationale: 'Cloudflare Workers runtime - lightweight responder',
              action: 'process',
              confidence: 0.5,
              signature: 'cloudflare-worker-mode',
              signerPubKey: 'cloudflare',
            },
          }));
        } catch (err: any) {
          server.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      });

      // @ts-ignore - Cloudflare Workers specific Response
      return new Response(null, { status: 101, webSocket: client });
    }

    // Timeline endpoint (HTTP fallback)
    if (url.pathname === '/timeline') {
      return new Response(JSON.stringify({ timeline: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
