export class SessionRelay implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    if (role !== 'agent' && role !== 'client') {
      return new Response('role must be agent or client', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const sessionId = url.pathname.split('/').at(-2) ?? 'unknown';
    const peerRole = role === 'agent' ? 'client' : 'agent';
    const sameRoleConnections = this.state.getWebSockets(role).length;
    const peerConnections = this.state.getWebSockets(peerRole).length;
    this.state.acceptWebSocket(server, [role, `session:${sessionId}`]);

    // Connection lifecycle only: never log frame contents, URLs, or the
    // client auth query parameter. These counts make a future hosted failure
    // distinguishable from an agent/PTY failure without exposing session data.
    console.info('session relay connected', {
      sessionId,
      role,
      sameRoleConnections,
      peerConnections,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Forward every message to the other side — DO is byte-agnostic.
  // Shell sessions use binary frames for PTY data and text frames for control
  // messages; TCP tunnel sessions use binary frames. The relay doesn't care.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const [role, sessionTag] = this.state.getTags(ws);
    const other = this.state.getWebSockets(role === 'agent' ? 'client' : 'agent');
    if (other.length === 0) {
      console.warn('session relay dropped frame without peer', {
        sessionId: sessionTag?.replace(/^session:/, '') ?? 'unknown',
        role,
        frameType: typeof message === 'string' ? 'text' : 'binary',
        frameBytes: typeof message === 'string' ? new TextEncoder().encode(message).byteLength : message.byteLength,
      });
      return;
    }
    for (const target of other) {
      target.send(message);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const [role, sessionTag] = this.state.getTags(ws);
    const peers = this.state.getWebSockets(role === 'agent' ? 'client' : 'agent');
    console.info('session relay disconnected', {
      sessionId: sessionTag?.replace(/^session:/, '') ?? 'unknown',
      role,
      code,
      peerConnections: peers.length,
    });
    for (const target of peers) {
      target.close(code, `${role} disconnected: ${reason}`);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const [role, sessionTag] = this.state.getTags(ws);
    console.error('session relay WebSocket error', {
      sessionId: sessionTag?.replace(/^session:/, '') ?? 'unknown',
      role,
    });
    ws.close(1011, 'internal error');
  }
}
