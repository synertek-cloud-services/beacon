import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { generateToken, sha256hex, bytesToBase64, toBase64Url, decryptSecret } from '../lib/crypto';
import { highestRole, type Role } from '../lib/auth';
import { verifyMicrosoftIdToken, fetchMemberGroups } from '../lib/oidc';

const authMicrosoft = new Hono<{ Bindings: Bindings }>();

const STATE_TTL_SECONDS = 10 * 60;
const EXCHANGE_TTL_SECONDS = 60;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(bytesToBase64(new Uint8Array(digest)));
}

function callbackUrl(reqUrl: string): string {
  return `${new URL(reqUrl).origin}/v1/auth/microsoft/callback`;
}

// GET /v1/auth/microsoft/login — redirect to Microsoft's authorize endpoint
authMicrosoft.get('/login', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const provider = await db
    .select()
    .from(schema.ssoProviders)
    .where(and(eq(schema.ssoProviders.type, 'microsoft'), eq(schema.ssoProviders.enabled, true)))
    .get();
  if (!provider) return c.json({ error: 'Microsoft SSO is not configured' }, 404);

  const codeVerifier = generateToken();
  const state = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const spaOrigin = c.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';

  await db.insert(schema.ssoLoginState).values({
    id: state,
    ssoProviderId: provider.id,
    codeVerifier,
    redirectUri: spaOrigin,
    createdAt: now,
    expiresAt: now + STATE_TTL_SECONDS,
  });

  const authorizeUrl = new URL(`https://login.microsoftonline.com/${provider.directoryId}/oauth2/v2.0/authorize`);
  authorizeUrl.searchParams.set('client_id', provider.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(c.req.url));
  authorizeUrl.searchParams.set('response_mode', 'query');
  // GroupMember.Read.All is required for the callback's Graph memberOf lookup — without
  // it, the token exchange succeeds but the group lookup gets rejected as insufficient
  // privilege. Requires admin consent in the Entra app registration.
  authorizeUrl.searchParams.set('scope', 'openid profile email GroupMember.Read.All');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', await pkceChallenge(codeVerifier));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return c.redirect(authorizeUrl.toString());
});

// GET /v1/auth/microsoft/callback — code exchange, id_token verify, group->role resolution
authMicrosoft.get('/callback', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.json({ error: 'missing code or state' }, 400);

  const stateRow = await db.select().from(schema.ssoLoginState).where(eq(schema.ssoLoginState.id, state)).get();
  if (stateRow) await db.delete(schema.ssoLoginState).where(eq(schema.ssoLoginState.id, state)); // single-use
  const now = Math.floor(Date.now() / 1000);
  if (!stateRow || stateRow.expiresAt < now) return c.json({ error: 'expired or invalid state' }, 400);

  const provider = await db.select().from(schema.ssoProviders).where(eq(schema.ssoProviders.id, stateRow.ssoProviderId)).get();
  if (!provider || !provider.enabled) return c.json({ error: 'provider not found or disabled' }, 400);

  const failLogin = (reason: string) => c.redirect(`${stateRow.redirectUri}/#/login?error=${encodeURIComponent(reason)}`);

  const clientSecret = await decryptSecret(provider.clientSecretCiphertext, provider.clientSecretNonce, c.env.CONFIG_ENCRYPTION_KEY);

  const tokenRes = await fetch(`https://login.microsoftonline.com/${provider.directoryId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(c.req.url),
      code_verifier: stateRow.codeVerifier,
    }),
  });
  if (!tokenRes.ok) return failLogin('token_exchange_failed');
  const tokenBody = await tokenRes.json<{ id_token: string; access_token: string }>();

  let claims;
  try {
    claims = await verifyMicrosoftIdToken(tokenBody.id_token, provider.directoryId, provider.clientId);
  } catch {
    return failLogin('id_token_verification_failed');
  }

  const groups = await fetchMemberGroups(tokenBody.access_token);
  const groupIds = groups.map(g => g.id);

  const mappings = groupIds.length
    ? await db.select()
        .from(schema.ssoGroupRoleMappings)
        .where(and(eq(schema.ssoGroupRoleMappings.ssoProviderId, provider.id), inArray(schema.ssoGroupRoleMappings.groupId, groupIds)))
        .all()
    : [];
  const role = highestRole(mappings.map(m => m.role as Role));
  if (!role) return failLogin('no_group_mapping');

  const email = claims.email ?? claims.preferred_username ?? `${claims.oid}@microsoft`;
  const displayName = claims.name ?? null;

  const existingByIdentity = await db.select().from(schema.users)
    .where(and(eq(schema.users.ssoProviderId, provider.id), eq(schema.users.ssoSubject, claims.oid)))
    .get();

  if (existingByIdentity) {
    await db.update(schema.users)
      .set({ role, displayName, email, lastLoginAt: now, updatedAt: now })
      .where(eq(schema.users.id, existingByIdentity.id));
  } else {
    // Guard against an Entra-side actor claiming a pre-existing local admin account
    // by registering a matching UPN — reject rather than silently merge identities.
    const existingByEmail = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (existingByEmail) return failLogin('email_already_registered_locally');

    await db.insert(schema.users).values({
      id: crypto.randomUUID(),
      email,
      displayName,
      role,
      authSource: 'microsoft',
      ssoProviderId: provider.id,
      ssoSubject: claims.oid,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  }

  const user = await db.select().from(schema.users)
    .where(and(eq(schema.users.ssoProviderId, provider.id), eq(schema.users.ssoSubject, claims.oid)))
    .get();
  if (!user || user.status !== 'active') return failLogin('account_disabled');

  const sessionToken = generateToken();
  await db.insert(schema.userSessions).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await sha256hex(sessionToken),
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
    userAgent: c.req.header('User-Agent') ?? null,
    ip: c.req.header('CF-Connecting-IP') ?? null,
  });

  const exchangeId = generateToken();
  await db.insert(schema.ssoExchangeCodes).values({
    id: exchangeId,
    sessionToken,
    createdAt: now,
    expiresAt: now + EXCHANGE_TTL_SECONDS,
  });

  return c.redirect(`${stateRow.redirectUri}/#/sso-callback?xchg=${exchangeId}`);
});

// POST /v1/auth/microsoft/exchange — trade the one-time code for the real session token
authMicrosoft.post('/exchange', async (c) => {
  const body = await c.req.json<{ code?: string }>();
  if (!body.code) return c.json({ error: 'code is required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const row = await db.select().from(schema.ssoExchangeCodes).where(eq(schema.ssoExchangeCodes.id, body.code)).get();
  if (row) await db.delete(schema.ssoExchangeCodes).where(eq(schema.ssoExchangeCodes.id, body.code)); // single-use
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expiresAt < now) return c.json({ error: 'expired or invalid code' }, 400);

  const tokenHash = await sha256hex(row.sessionToken);
  const userRow = await db.select({
      id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName,
      role: schema.users.role, authSource: schema.users.authSource,
    })
    .from(schema.userSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.userSessions.userId))
    .where(eq(schema.userSessions.tokenHash, tokenHash))
    .get();
  if (!userRow) return c.json({ error: 'session not found' }, 400);

  return c.json({ token: row.sessionToken, user: userRow });
});

export default authMicrosoft;
