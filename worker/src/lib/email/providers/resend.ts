import type { EmailProvider } from '../types';

const resend: EmailProvider = {
  async send(config, message) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text().catch(() => res.statusText)}`);
  },
};

export default resend;
