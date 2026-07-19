import type { EmailProvider } from '../types';
import { sha256hex } from '../../crypto';

// No AWS SDK dependency (too large, not Workers-optimized for a single
// action) -- a hand-rolled AWS Signature Version 4 signer for SESv2's
// SendEmail REST action, entirely via crypto.subtle.
async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ses: EmailProvider = {
  async send(config, message) {
    const { accessKeyId, secretAccessKey, region } = config;
    const host = `email.${region}.amazonaws.com`;
    const uri = '/v2/email/outbound-emails';
    const payload = JSON.stringify({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject },
          Body: { Html: { Data: message.html }, Text: { Data: message.text } },
        },
      },
    });

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

    // host is never set manually on the fetch() call below -- Workers sets
    // it itself -- it only appears here, in the canonical request string.
    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-date';
    const payloadHash = await sha256hex(payload);
    const canonicalRequest = `POST\n${uri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256hex(canonicalRequest)}`;

    const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, 'ses');
    const kSigning = await hmacSha256(kService, 'aws4_request');
    const signature = toHex(await hmacSha256(kSigning, stringToSign));

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`https://${host}${uri}`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        'X-Amz-Date': amzDate,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    if (!res.ok) throw new Error(`SES send failed: ${res.status} ${await res.text().catch(() => res.statusText)}`);
  },
};

export default ses;
