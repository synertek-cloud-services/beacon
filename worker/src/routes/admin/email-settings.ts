import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';
import { encryptSecret } from '../../lib/crypto';

// Singleton config for the one active email provider (see
// worker/src/lib/email/ for the plugin architecture that actually sends).
// Same "secret never returned, blank input means keep existing" pattern as
// sso.ts's provider config.
const emailSettings = new Hono<{ Bindings: Bindings }>();

// Runtime validation -- the TS type annotation on the PATCH body only
// checks callers written in TypeScript, not the actual JSON payload. An
// unrecognized value here would otherwise sit silently in the provider
// column until sendEmail() throws on PROVIDERS[undefined].send().
const VALID_PROVIDERS = ['ses', 'resend', 'mailgun'] as const;

function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'admin');
}

emailSettings.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const row = await drizzle(c.env.DB, { schema }).select().from(schema.emailSettings).where(eq(schema.emailSettings.id, 1)).get();
  if (!row) return c.json({ error: 'email settings not configured' }, 404);
  const { configCiphertext, configNonce, ...rest } = row;
  return c.json({ ...rest, hasConfig: !!configCiphertext });
});

emailSettings.patch('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{
    provider?: 'ses' | 'resend' | 'mailgun';
    fromAddress?: string;
    enabled?: boolean;
    config?: Record<string, string>;
  }>();
  if (body.provider !== undefined && !VALID_PROVIDERS.includes(body.provider)) {
    return c.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` }, 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const updates: Partial<typeof schema.emailSettings.$inferInsert> = { updatedAt: now };
  if (body.provider !== undefined) updates.provider = body.provider;
  if (body.fromAddress !== undefined) updates.fromAddress = body.fromAddress;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.config) {
    const { ciphertext, nonce } = await encryptSecret(JSON.stringify(body.config), c.env.CONFIG_ENCRYPTION_KEY);
    updates.configCiphertext = ciphertext;
    updates.configNonce = nonce;
  }

  await db.update(schema.emailSettings).set(updates).where(eq(schema.emailSettings.id, 1));
  return c.json({ ok: true });
});

export default emailSettings;
