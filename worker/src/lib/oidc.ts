import { createRemoteJWKSet, jwtVerify } from 'jose';

// The one deliberate exception to this codebase's zero-third-party-crypto posture:
// hand-rolling JWKS fetch/cache + RS256 verify + issuer/audience/alg-confusion checks
// is a well-known footgun class, and this gates who can authenticate as Beacon admin.
// `jose` is edge-runtime-first and keeps this to one narrow file.

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(directoryId: string) {
  let jwks = jwksCache.get(directoryId);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${directoryId}/discovery/v2.0/keys`));
    jwksCache.set(directoryId, jwks);
  }
  return jwks;
}

export interface MicrosoftIdTokenClaims {
  oid: string;   // Entra object id — the stable subject identifier
  email?: string;
  preferred_username?: string;
  name?: string;
}

export async function verifyMicrosoftIdToken(idToken: string, directoryId: string, clientId: string): Promise<MicrosoftIdTokenClaims> {
  const { payload } = await jwtVerify(idToken, jwksFor(directoryId), {
    issuer: `https://login.microsoftonline.com/${directoryId}/v2.0`,
    audience: clientId,
  });
  if (typeof payload.oid !== 'string') throw new Error('id token missing oid claim');
  return payload as unknown as MicrosoftIdTokenClaims;
}

export interface GraphGroup {
  id: string;
  displayName?: string;
}

// Always call Graph rather than trusting the ID token's `groups` claim — Entra only
// embeds direct group membership below ~200 groups; above that it returns an overage
// indicator requiring a Graph call anyway, so always calling it keeps behavior uniform.
export async function fetchMemberGroups(accessToken: string): Promise<GraphGroup[]> {
  const groups: GraphGroup[] = [];
  let url: string | undefined = 'https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName';

  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Graph memberOf request failed: ${res.status}`);
    const body = await res.json<{ value: GraphGroup[]; '@odata.nextLink'?: string }>();
    groups.push(...body.value);
    url = body['@odata.nextLink'];
  }

  return groups;
}
