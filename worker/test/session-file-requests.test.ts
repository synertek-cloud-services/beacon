import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { sha256hex } from '../src/lib/crypto';

// Hono matches routes in registration order, so GET .../file-requests/next must
// be registered before GET .../file-requests/:reqId or "next" is captured as a
// request id and the screen-share helper can never claim a pending request.

const NOW = Math.floor(Date.now() / 1000);
const SESSION = 'sfr-session';
const REPORT_TOKEN = 'sfr-report-token';
const ADMIN = 'sfr-admin-secret';

async function seed() {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO companies(id,name,auto_approve_default,privacy_mode_default,status,created_at) VALUES(?,?,?,?,?,?)`)
      .bind('sfr-co', 'SFR Co', 1, 0, 'active', NOW),
    env.DB.prepare(`INSERT OR IGNORE INTO enrollment_tokens(id,company_id,token_hash,agent_type,use_count,created_at,created_by) VALUES(?,?,?,?,?,?,?)`)
      .bind('sfr-tok', 'sfr-co', 'h', 'windows', 0, NOW, 'test'),
    env.DB.prepare(`INSERT OR IGNORE INTO devices(id,company_id,enrollment_token_id,agent_type,device_credential_hash,status,hostname,os_type,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind('sfr-dev', 'sfr-co', 'sfr-tok', 'windows', 'x', 'approved', 'SFR', 'windows', NOW),
  ]);
  await env.DB.prepare(`INSERT OR REPLACE INTO sessions(id,device_id,company_id,session_type,status,created_at,report_token_hash) VALUES(?,?,?,?,?,?,?)`)
    .bind(SESSION, 'sfr-dev', 'sfr-co', 'screen_share', 'pending', NOW, await sha256hex(REPORT_TOKEN)).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO session_file_requests(id,session_id,type,status,request,created_at) VALUES(?,?,?,?,?,?)`)
    .bind('11111111-1111-4111-8111-111111111111', SESSION, 'upload', 'pending', JSON.stringify({ filename: 'a.txt' }), NOW).run();
}

function get(path: string, token: string) {
  const e = { ...env, ADMIN_SECRET: ADMIN } as typeof env;
  return worker.fetch(new Request(`https://beacon.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), e);
}

describe('session file-request routes', () => {
  it('routes /next to the helper handler, which claims the pending request', async () => {
    await seed();
    const res = await get(`/v1/sessions/${SESSION}/file-requests/next`, REPORT_TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', type: 'upload' });
  });

  it('routes a real request id to the request-status handler', async () => {
    await seed();
    const res = await get(`/v1/sessions/${SESSION}/file-requests/11111111-1111-4111-8111-111111111111`, ADMIN);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'pending' });
  });
});

describe('POST file-requests path validation', () => {
  function post(body: unknown) {
    const e = { ...env, ADMIN_SECRET: ADMIN } as typeof env;
    return worker.fetch(new Request(`https://beacon.test/v1/sessions/${SESSION}/file-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), e);
  }

  it('accepts an empty browse path (the drive list)', async () => {
    await seed();
    expect((await post({ type: 'browse', path: '' })).status).toBe(201);
  });

  it('still requires a path for a download', async () => {
    await seed();
    expect((await post({ type: 'download', path: '' })).status).toBe(400);
  });
});
