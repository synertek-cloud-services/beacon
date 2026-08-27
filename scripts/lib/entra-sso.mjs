// Pure helpers for scripts/setup-entra-sso.mjs -- kept dependency-free and
// side-effect-free so they're unit-testable without a real Entra tenant.
// See test-entra-sso.mjs.

// Microsoft's own well-known, stable identifiers -- not secrets, not
// Beacon-specific. Verified against Microsoft Graph's permissions reference
// and the community-maintained FOCI (Family of Client IDs) list as of this
// writing; Microsoft does not rotate these.
export const AZURE_CLI_CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';
export const MICROSOFT_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
export const GROUP_MEMBER_READ_ALL_DELEGATED_ID = 'bc024368-1153-4739-b217-4326f2e966d0';
export const GROUP_READ_ALL_APPLICATION_ID = '5b567255-7703-4780-807c-7be8301ae99b';

export function validateDisplayName(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error('App display name must not be empty');
  if (trimmed.length > 256) throw new Error('App display name must be 256 characters or fewer');
  return trimmed;
}

export function buildRedirectUri(workerOrigin) {
  return `${workerOrigin}/v1/auth/microsoft/callback`;
}

// requestAccess: 'Scope' = delegated permission, 'Role' = application permission.
// Both target Microsoft Graph and match Beacon's documented SSO requirements
// (worker/src/lib/oidc.ts, worker/src/routes/auth-microsoft.ts).
export function buildApplicationPayload({ displayName, redirectUri }) {
  return {
    displayName: validateDisplayName(displayName),
    signInAudience: 'AzureADMyOrg',
    web: {
      redirectUris: [redirectUri],
      implicitGrantSettings: { enableIdTokenIssuance: false, enableAccessTokenIssuance: false },
    },
    requiredResourceAccess: [
      {
        resourceAppId: MICROSOFT_GRAPH_APP_ID,
        resourceAccess: [
          { id: GROUP_MEMBER_READ_ALL_DELEGATED_ID, type: 'Scope' },
          { id: GROUP_READ_ALL_APPLICATION_ID, type: 'Role' },
        ],
      },
    ],
  };
}

export function buildSecretPayload({ displayName, monthsValid }) {
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + monthsValid);
  return {
    passwordCredential: {
      displayName,
      startDateTime: now.toISOString(),
      endDateTime: end.toISOString(),
    },
  };
}

// Classifies an RFC 8628 device-authorization-grant error response.
// 'pending'/'slow_down' mean "keep polling"; anything else is terminal.
export function classifyDeviceCodeError(body) {
  switch (body?.error) {
    case 'authorization_pending': return 'pending';
    case 'slow_down': return 'slow_down';
    case 'expired_token': return 'expired';
    case 'authorization_declined': return 'declined';
    default: return 'fatal';
  }
}

// Redirects back to the app's own registered redirect URI after consent --
// that's the only URI Entra will accept here, since it must already be
// registered on the app. Landing on Beacon's OIDC callback with admin-consent
// query params instead of an auth code is expected and harmless: consent has
// already been recorded tenant-wide by the time the browser gets there.
export function adminConsentUrl({ tenantId, clientId, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'https://graph.microsoft.com/.default',
    redirect_uri: redirectUri,
  });
  return `https://login.microsoftonline.com/${tenantId}/v2.0/adminconsent?${params}`;
}
