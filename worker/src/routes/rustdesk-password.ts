import { Hono } from 'hono';
import type { Bindings } from '../index';
import { sha256hex, decryptSecret } from '../lib/crypto';

const rustdeskPassword = new Hono<{ Bindings: Bindings }>();

// An enrolled agent redeems its own generated unattended-access password
// exactly once during an install_rustdesk command -- same auth shape as
// rustdesk-installer-download.ts/component-files.ts (device credential +
// short-lived grant token, both hashed and matched server-side), but
// decrypts and returns a small JSON secret instead of streaming a file.
// The plaintext password is deliberately never placed in commands.payload
// or commands.result (both visible verbatim in Device Detail's Command
// History) -- this grant/redeem indirection is the only path it ever
// travels over the wire.
rustdeskPassword.post('/redeem', async (c) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) return c.json({ error: 'missing authorization' }, 401);

  let body: { token?: string };
  try {
    body = await c.req.json<{ token?: string }>();
  } catch {
    return c.json({ error: 'invalid request body' }, 400);
  }
  if (!body.token || body.token.length < 32) return c.json({ error: 'invalid redemption token' }, 400);

  const [credentialHash, tokenHash] = await Promise.all([
    sha256hex(authorization.slice(7)),
    sha256hex(body.token),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const grant = await c.env.DB.prepare(
    `SELECT g.id, d.rustdesk_password_ciphertext, d.rustdesk_password_nonce, d.device_credential_hash, d.status AS device_status, c.status AS command_status
     FROM rustdesk_password_grants g
     JOIN devices d ON d.id = g.device_id
     JOIN commands c ON c.id = g.command_id
     WHERE g.token_hash = ? AND g.expires_at > ?`
  ).bind(tokenHash, now).first<{
    id: string; rustdesk_password_ciphertext: string | null; rustdesk_password_nonce: string | null;
    device_credential_hash: string; device_status: string; command_status: string;
  }>();
  if (!grant) return c.json({ error: 'redemption grant expired or not found' }, 404);
  if (grant.device_credential_hash !== credentialHash) return c.json({ error: 'redemption grant does not belong to this device' }, 403);
  if (grant.device_status === 'revoked') return c.json({ error: 'device revoked' }, 403);
  if (grant.command_status !== 'queued' && grant.command_status !== 'sent') return c.json({ error: 'command is no longer active' }, 409);
  if (!grant.rustdesk_password_ciphertext || !grant.rustdesk_password_nonce) return c.json({ error: 'password unavailable' }, 404);

  const password = await decryptSecret(grant.rustdesk_password_ciphertext, grant.rustdesk_password_nonce, c.env.CONFIG_ENCRYPTION_KEY);
  await c.env.DB.prepare(
    `UPDATE rustdesk_password_grants SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL`
  ).bind(now, grant.id).run();

  return c.json({ password }, 200, { 'Cache-Control': 'no-store' });
});

export default rustdeskPassword;
