export async function sha256hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 32 random bytes as a hex string — used for device credentials and enrollment tokens.
// High-entropy random input makes SHA-256 storage sufficient (no bcrypt needed).
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

// AES-GCM at rest for secrets that must be recovered in plaintext (e.g. an SSO client
// secret we have to hand back to the identity provider) — unlike device/enrollment
// tokens, which are only ever verified, never read back, so a one-way hash suffices there.
export async function encryptSecret(plaintext: string, keyHex: string): Promise<{ ciphertext: string; nonce: string }> {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt']);
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), nonce: bytesToBase64(nonce) };
}

export async function decryptSecret(ciphertext: string, nonce: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(nonce) },
    key,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}
