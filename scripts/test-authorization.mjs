import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const args = new Set(argv);
const baseUrl = process.env.BEACON_WORKER_URL?.replace(/\/$/, '');
const adminSecret = process.env.BEACON_ADMIN_SECRET;
const option = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1];
};
const expiryDatabase = option('--expiry-d1');
const wranglerConfig = option('--wrangler-config');
const localPersistPath = option('--expiry-local-persist');

if (!baseUrl || !adminSecret) {
  console.error('Set BEACON_WORKER_URL and BEACON_ADMIN_SECRET.');
  process.exit(2);
}
if (!args.has('--allow-mutations')) {
  console.error('This drill creates disposable users, companies, a device, and an inert agent-version record. Pass --allow-mutations.');
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl) && !args.has('--allow-remote')) {
  console.error('Refusing to mutate a remote deployment without --allow-remote. Use only an isolated disposable deployment.');
  process.exit(2);
}

const runId = crypto.randomUUID();
const password = `Beacon-${crypto.randomUUID()}-aA1!`;
const secretValue = `secret-${crypto.randomUUID()}`;
const createdUserIds = [];
const createdCompanyIds = [];

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function request(method, path, { token, body, expected = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? bearer(token) : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${text}`);
  return payload;
}

async function createUser(role) {
  const email = `authorization-${role}-${runId}@example.invalid`;
  const result = await request('POST', '/v1/admin/users', {
    token: adminSecret,
    body: { email, displayName: `Authorization ${role}`, role, password },
    expected: 201,
  });
  createdUserIds.push(result.id);
  const login = await request('POST', '/v1/auth/login', { body: { email, password } });
  assert.equal(login.user.role, role);
  return { id: result.id, email, token: login.token };
}

async function setUser(id, body) {
  return request('PATCH', `/v1/admin/users/${id}`, { token: adminSecret, body });
}

function expireSession(token) {
  assert.ok(expiryDatabase && wranglerConfig, '--expiry-d1 and --wrangler-config must be supplied for an expiry check');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const wrangler = resolve(dirname(fileURLToPath(import.meta.url)), '../worker/node_modules/.bin/wrangler');
  const commandArgs = [
    'd1', 'execute', expiryDatabase,
    '--config', resolve(wranglerConfig),
    ...(localPersistPath ? ['--local', '--persist-to', resolve(localPersistPath)] : ['--remote']),
    '--command', `UPDATE user_sessions SET expires_at = 0 WHERE token_hash = '${tokenHash}'`,
  ];
  const result = spawnSync(wrangler, commandArgs, {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../worker'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, 'failed to expire the disposable D1 session');
}

async function main() {
  await request('GET', '/health');
  const admin = await createUser('admin');
  const technician = await createUser('technician');
  const readonly = await createUser('readonly');

  for (const [role, user] of Object.entries({ admin, technician, readonly })) {
    const me = await request('GET', '/v1/auth/me', { token: user.token });
    assert.equal(me.role, role);
  }

  await request('GET', '/v1/admin/companies', { token: readonly.token });
  await request('POST', '/v1/admin/companies', {
    token: readonly.token,
    body: { name: `Denied ${runId}` },
    expected: 401,
  });

  const company = await request('POST', '/v1/admin/companies', {
    token: technician.token,
    body: { name: `Authorization Test ${runId}`, auto_approve_default: true },
    expected: 201,
  });
  createdCompanyIds.push(company.id);

  await request('GET', `/v1/admin/companies/${company.id}/variables`, { token: readonly.token, expected: 401 });
  await request('GET', `/v1/admin/companies/${company.id}/variables`, { token: technician.token, expected: 401 });
  await request('POST', `/v1/admin/companies/${company.id}/variables`, {
    token: technician.token,
    body: { key: 'DENIED', is_secret: true, value: secretValue },
    expected: 401,
  });
  await request('POST', `/v1/admin/companies/${company.id}/variables`, {
    token: admin.token,
    body: { key: 'AUDIT_SECRET', is_secret: true, value: secretValue },
    expected: 201,
  });
  const variables = await request('GET', `/v1/admin/companies/${company.id}/variables`, { token: admin.token });
  const serializedVariables = JSON.stringify(variables);
  assert.ok(!serializedVariables.includes(secretValue), 'secret plaintext leaked from company variables');
  assert.ok(!serializedVariables.includes('valueCiphertext'), 'secret ciphertext leaked from company variables');
  assert.ok(!serializedVariables.includes('valueNonce'), 'secret nonce leaked from company variables');

  const versionBody = {
    version: `0.0.0-auth-${runId}`,
    os: 'authorization-test',
    arch: runId,
    download_url: 'https://example.invalid/authorization-test',
    signature_hex: '00'.repeat(64),
  };
  await request('POST', '/v1/admin/agent/versions', { token: technician.token, body: versionBody, expected: 401 });
  await request('POST', '/v1/admin/agent/versions', { token: admin.token, body: versionBody });

  const enrollment = await request('POST', `/v1/admin/companies/${company.id}/tokens`, {
    token: technician.token,
    body: { auto_approve: true, max_uses: 1 },
    expected: 201,
  });
  const enrolled = await request('POST', '/v1/enroll', {
    token: enrollment.raw_token,
    body: {
      hostname: `auth-test-${runId}`,
      os_type: 'linux',
      os_version: 'test',
      agent_version: '0.0.0-test',
      detected_class: 'server',
    },
  });
  const devices = await request('GET', '/v1/admin/devices', { token: readonly.token });
  const listed = devices.find((device) => device.id === enrolled.device_id);
  assert.ok(listed, 'enrolled test device missing from device list');
  for (const device of [listed, await request('GET', `/v1/admin/devices/${enrolled.device_id}`, { token: readonly.token })]) {
    assert.ok(!Object.hasOwn(device, 'deviceCredentialHash'), 'device credential hash leaked');
    assert.ok(!Object.hasOwn(device, 'enrollmentTokenId'), 'enrollment-token provenance leaked');
  }

  await setUser(readonly.id, { role: 'technician' });
  await request('POST', '/v1/admin/companies', {
    token: readonly.token,
    body: { name: `Role Change ${runId}` },
    expected: 201,
  }).then((row) => createdCompanyIds.push(row.id));
  await setUser(readonly.id, { role: 'readonly' });
  await request('POST', '/v1/admin/companies', {
    token: readonly.token,
    body: { name: `Denied Again ${runId}` },
    expected: 401,
  });

  await setUser(technician.id, { status: 'disabled' });
  await request('GET', '/v1/auth/me', { token: technician.token, expected: 401 });
  await setUser(technician.id, { status: 'active' });
  await request('GET', '/v1/auth/me', { token: technician.token });

  const logoutLogin = await request('POST', '/v1/auth/login', { body: { email: admin.email, password } });
  await request('POST', '/v1/auth/logout', { token: logoutLogin.token });
  await request('GET', '/v1/auth/me', { token: logoutLogin.token, expected: 401 });

  if (expiryDatabase || wranglerConfig || localPersistPath) {
    const expiryLogin = await request('POST', '/v1/auth/login', { body: { email: admin.email, password } });
    expireSession(expiryLogin.token);
    await request('GET', '/v1/auth/me', { token: expiryLogin.token, expected: 401 });
  } else {
    console.log('Session-expiry check skipped; provide an isolated D1 target to enable it.');
  }

  console.log('Authorization drill passed: roles, live role/disable/logout changes, admin-only secrets/releases, and credential redaction.');
}

try {
  await main();
} finally {
  for (const id of createdCompanyIds) {
    await request('PATCH', `/v1/admin/companies/${id}`, { token: adminSecret, body: { status: 'suspended' } }).catch(() => {});
  }
  for (const id of createdUserIds) {
    await request('DELETE', `/v1/admin/users/${id}`, { token: adminSecret }).catch(() => {});
  }
}
