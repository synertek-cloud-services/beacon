// generateRustdeskPassword returns a random unattended-access password for
// a freshly-installed RustDesk client. Restricted to alphanumerics (no
// quotes, backslashes, percent signs, or whitespace) since this value is
// eventually passed as a literal Windows command-line argument
// (`rustdesk.exe --password <value>`) on the agent side -- avoiding any
// character that could complicate that quoting is simpler and safer than
// getting Windows argument-escaping exactly right for an arbitrary string.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const PASSWORD_LENGTH = 24;

export function generateRustdeskPassword(): string {
  const bytes = new Uint8Array(PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}
