// One DeviceHub per device (idFromName(deviceId)). The agent holds a single
// hibernating WebSocket to it; the only thing the hub ever sends is the text
// frame "wake", which tells the agent to run its normal check-in now instead
// of waiting out its poll interval. Commands, sessions and jobs are still
// delivered by the ordinary check-in response, so delivery logic lives in one
// place and a lost wake only costs one poll interval.
//
// Billing shape: incoming WebSocket messages bill 20:1, while outgoing
// messages and auto-response ping/pong replies are free and don't wake the
// object, so an idle device costs essentially nothing.
export class DeviceHub implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/wake') {
      let woken = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send('wake');
          woken++;
        } catch { /* dead socket -- it will be reaped on close */ }
      }
      return Response.json({ woken });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // One live socket per device: a reconnecting agent supersedes any older
    // (possibly half-dead) connection rather than accumulating them.
    for (const old of this.state.getWebSockets()) {
      try { old.close(1000, 'superseded'); } catch { /* already closed */ }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // The agent sends nothing but "ping" (auto-responded); ignore anything else.
  webSocketMessage(): void {}

  webSocketClose(ws: WebSocket, code: number): void {
    // 1005/1006 are reserved and can't be sent in a close frame.
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
  }
}
