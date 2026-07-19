import type { EmailProvider } from './types';
import resend from './providers/resend';
import mailgun from './providers/mailgun';
import ses from './providers/ses';

export type ProviderType = 'ses' | 'resend' | 'mailgun';

// The one place that knows every provider exists. Adding a new one: a new
// file in providers/ matching EmailProvider, plus one line here.
export const PROVIDERS: Record<ProviderType, EmailProvider> = { ses, resend, mailgun };
