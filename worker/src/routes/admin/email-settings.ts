import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { PROVIDERS } from '../../lib/email/registry';

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

// Sends a real email through the currently-saved-and-enabled config to the
// requesting admin's own address, so a broken provider config is caught at
// configuration time instead of silently failing inside sendEmail()'s
// fire-and-forget Promise.allSettled the first time a real alert fires.
// Calls provider.send() directly (not sendEmail()) so a failure reaches this
// response synchronously instead of being swallowed into console.error.
emailSettings.post('/test', async (c) => {
  const actor = await requireUser(c.req.header('Authorization'), c.env, 'admin');
  if (!actor) return c.json({ error: 'unauthorized' }, 401);

  // The break-glass ADMIN_SECRET identity has no real email address
  // (auth.ts's synthetic 'break-glass@local') -- sending "to" that would
  // fail against a fake address and misattribute the failure to the
  // provider config rather than to the caller having no real inbox.
  if (actor.source === 'break-glass') {
    return c.json({ ok: false, error: 'Emergency access has no real email address -- sign in as a user to send a test email.' });
  }

  const row = await drizzle(c.env.DB, { schema }).select().from(schema.emailSettings).where(eq(schema.emailSettings.id, 1)).get();
  if (!row || !row.enabled || !row.provider || !row.configCiphertext || !row.configNonce || !row.fromAddress) {
    return c.json({ error: 'Save and enable email settings first' }, 400);
  }

  try {
    const config = JSON.parse(await decryptSecret(row.configCiphertext, row.configNonce, c.env.CONFIG_ENCRYPTION_KEY)) as Record<string, string>;
    await PROVIDERS[row.provider].send(config, {
      from: row.fromAddress,
      to: actor.email,
      subject: '[Beacon] Test email',
      html: '<p>This is a test email from Beacon to confirm your email provider configuration is working.</p>',
      text: 'This is a test email from Beacon to confirm your email provider configuration is working.',
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default emailSettings;
