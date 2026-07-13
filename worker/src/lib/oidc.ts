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
// transitiveMemberOf (not memberOf) so nested group membership resolves correctly —
// a user in "Sub-Team" which is itself a member of "IT-Technicians" should still match
// a mapping on "IT-Technicians".
export async function fetchMemberGroups(accessToken: string): Promise<GraphGroup[]> {
  const groups: GraphGroup[] = [];
  let url: string | undefined = 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id,displayName';

  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Graph memberOf request failed: ${res.status}`);
    const body = await res.json<{ value: GraphGroup[]; '@odata.nextLink'?: string }>();
    groups.push(...body.value);
    url = body['@odata.nextLink'];
  }

  return groups;
}

// App-only (client credentials) Graph token — used for admin-initiated background
// lookups like group search, where there's no signed-in Microsoft user token to reuse
// (the Beacon admin configuring SSO may well be logged in locally, not via Microsoft).
// Requires the app registration to have Group.Read.All as an *Application* permission
// (not Delegated) with admin consent, separate from the GroupMember.Read.All delegated
// scope used during actual user logins.
export async function getAppOnlyGraphToken(directoryId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${directoryId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!res.ok) throw new Error(`client_credentials token request failed: ${res.status}`);
  const body = await res.json<{ access_token: string }>();
  return body.access_token;
}

export async function searchGroups(accessToken: string, query: string): Promise<GraphGroup[]> {
  // Strip quotes so the raw query can't break out of Graph's $search syntax.
  const safeQuery = query.replace(/"/g, '');
  const url = new URL('https://graph.microsoft.com/v1.0/groups');
  url.searchParams.set('$search', `"displayName:${safeQuery}"`);
  url.searchParams.set('$select', 'id,displayName');
  url.searchParams.set('$top', '25');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: 'eventual', // required by Graph for $search on groups
    },
  });
  if (!res.ok) throw new Error(`Graph group search failed: ${res.status}`);
  const body = await res.json<{ value: GraphGroup[] }>();
  return body.value;
}
