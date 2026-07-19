import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../db/schema';
import type { Bindings } from '../../index';
import { decryptSecret } from '../crypto';
import { PROVIDERS } from './registry';

// No provider-specific branching here -- everything provider-specific lives
// in worker/src/lib/email/providers/*. Mirrors fireWebhooks' fire-and-forget
// shape (worker/src/lib/alerts.ts) -- a failed send must never break the
// check-in/audit/cron request that triggered it.
export async function sendEmail(env: Bindings, to: string[], subject: string, html: string, text: string): Promise<void> {
  if (to.length === 0) return;
  const db = drizzle(env.DB, { schema });
  const settings = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.id, 1)).get();
  if (!settings || !settings.enabled || !settings.provider || !settings.configCiphertext || !settings.configNonce || !settings.fromAddress) return;

  const config = JSON.parse(await decryptSecret(settings.configCiphertext, settings.configNonce, env.CONFIG_ENCRYPTION_KEY)) as Record<string, string>;
  const provider = PROVIDERS[settings.provider];
  const fromAddress = settings.fromAddress;

  await Promise.allSettled(
    to.map(recipient =>
      provider.send(config, { from: fromAddress, to: recipient, subject, html, text })
        .catch(err => console.error('sendEmail failed', settings.provider, err)),
    ),
  );
}
