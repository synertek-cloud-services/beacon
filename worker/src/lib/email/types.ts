export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Every provider owns its own config shape, auth scheme, and request
// encoding entirely within its own file -- registry.ts and index.ts never
// branch on provider type. Adding a new provider is one new file matching
// this interface plus one line in registry.ts.
export interface EmailProvider {
  send(config: Record<string, string>, message: EmailMessage): Promise<void>;
}
