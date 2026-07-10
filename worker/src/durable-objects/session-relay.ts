export class SessionRelay implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const role = new URL(request.url).searchParams.get('role');
    if (role !== 'agent' && role !== 'client') {
      return new Response('role must be agent or client', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [role]);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Forward every message to the other side — DO is byte-agnostic.
  // Shell sessions send JSON frames; TCP tunnel sessions send binary frames.
  // The relay doesn't care which.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const [role] = this.state.getTags(ws);
    const other = this.state.getWebSockets(role === 'agent' ? 'client' : 'agent');
    for (const target of other) {
      target.send(message);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const [role] = this.state.getTags(ws);
    for (const target of this.state.getWebSockets(role === 'agent' ? 'client' : 'agent')) {
      target.close(code, `${role} disconnected: ${reason}`);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, 'internal error');
  }
}
