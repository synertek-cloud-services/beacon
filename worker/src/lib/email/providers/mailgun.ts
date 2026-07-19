import type { EmailProvider } from '../types';

const mailgun: EmailProvider = {
  async send(config, message) {
    const base = config.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
    const body = new URLSearchParams({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    const res = await fetch(`https://${base}/v3/${config.domain}/messages`, {
      method: 'POST',
      headers: {
        // Mailgun uses HTTP Basic with the literal username "api".
        'Authorization': `Basic ${btoa(`api:${config.apiKey}`)}`,
      },
      body,
    });
    if (!res.ok) throw new Error(`Mailgun send failed: ${res.status} ${await res.text().catch(() => res.statusText)}`);
  },
};

export default mailgun;
