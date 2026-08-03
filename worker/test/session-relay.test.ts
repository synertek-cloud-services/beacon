import { env } from 'cloudflare:workers';
import { evictAllDurableObjects, evictDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

type Role = 'agent' | 'client';

async function connect(stub: DurableObjectStub, sessionId: string, role: Role): Promise<WebSocket> {
  const response = await stub.fetch(`https://relay.test/v1/sessions/${sessionId}/ws?role=${role}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  if (!response.webSocket) throw new Error('expected WebSocket upgrade');
  response.webSocket.binaryType = 'arraybuffer';
  response.webSocket.accept();
  return response.webSocket;
}

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => socket.addEventListener('message', resolve, { once: true }));
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
}

function expectBinaryMessage(event: MessageEvent, expected: Uint8Array): void {
  expect(event.data).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(event.data as ArrayBuffer)).toEqual(expected);
}

afterEach(async () => {
  // A test client does not complete WebSocket close handshakes exactly like a
  // browser. Close any remaining runtime-side sockets so the suite never waits
  // for the Durable Object eviction timeout.
  await evictAllDurableObjects({ webSockets: 'close' });
});

describe('SessionRelay', () => {
  it.each([
    ['client-first', 'client', 'agent'],
    ['agent-first', 'agent', 'client'],
  ] as const)('forwards binary frames in both directions when connected %s', async (_name, firstRole, secondRole) => {
    const sessionId = crypto.randomUUID();
    const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
    const first = await connect(stub, sessionId, firstRole);
    const second = await connect(stub, sessionId, secondRole);
    const client = firstRole === 'client' ? first : second;
    const agent = firstRole === 'agent' ? first : second;

    const toAgent = nextMessage(agent);
    const clientPayload = new Uint8Array([0, 1, 2, 127, 128, 255]);
    client.send(clientPayload);
    expectBinaryMessage(await toAgent, clientPayload);

    const toClient = nextMessage(client);
    const agentPayload = new Uint8Array([255, 128, 127, 2, 1, 0]);
    agent.send(agentPayload);
    expectBinaryMessage(await toClient, agentPayload);

    const agentClosed = nextClose(agent);
    client.close(1000, 'test complete');
    const closeEvent = await agentClosed;
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toContain('client disconnected');
  });

  it('retains role tags and forwarding after hibernation', async () => {
    const sessionId = crypto.randomUUID();
    const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
    const client = await connect(stub, sessionId, 'client');
    const agent = await connect(stub, sessionId, 'agent');

    await evictDurableObject(stub);

    const received = nextMessage(client);
    const payload = new Uint8Array([10, 20, 30, 40]);
    agent.send(payload);
    expectBinaryMessage(await received, payload);

    const agentClosed = nextClose(agent);
    client.close(1000, 'test complete');
    expect((await agentClosed).code).toBe(1000);
  });

  it('normalizes a browser close without a status code and closes the peer', async () => {
    const sessionId = crypto.randomUUID();
    const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
    const client = await connect(stub, sessionId, 'client');
    const agent = await connect(stub, sessionId, 'agent');

    const agentClosed = nextClose(agent);
    client.close();

    const closeEvent = await agentClosed;
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toBe('client disconnected');
  });
});
