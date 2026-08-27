import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GROUP_MEMBER_READ_ALL_DELEGATED_ID,
  GROUP_READ_ALL_APPLICATION_ID,
  MICROSOFT_GRAPH_APP_ID,
  adminConsentUrl,
  buildApplicationPayload,
  buildRedirectUri,
  buildSecretPayload,
  classifyDeviceCodeError,
  validateDisplayName,
} from './lib/entra-sso.mjs';

test('builds the OIDC callback redirect URI from a Worker origin', () => {
  assert.equal(buildRedirectUri('https://beacon-api.example.com'), 'https://beacon-api.example.com/v1/auth/microsoft/callback');
});

test('rejects an empty app display name', () => {
  assert.throws(() => validateDisplayName(''), /must not be empty/);
  assert.throws(() => validateDisplayName('   '), /must not be empty/);
});

test('rejects an overlong app display name', () => {
  assert.throws(() => validateDisplayName('x'.repeat(257)), /256 characters or fewer/);
});

test('application payload declares both required Graph permissions on the right resource', () => {
  const payload = buildApplicationPayload({ displayName: 'Beacon RMM', redirectUri: 'https://api.example.com/v1/auth/microsoft/callback' });
  assert.equal(payload.displayName, 'Beacon RMM');
  assert.equal(payload.signInAudience, 'AzureADMyOrg');
  assert.deepEqual(payload.web.redirectUris, ['https://api.example.com/v1/auth/microsoft/callback']);

  assert.equal(payload.requiredResourceAccess.length, 1);
  const graphAccess = payload.requiredResourceAccess[0];
  assert.equal(graphAccess.resourceAppId, MICROSOFT_GRAPH_APP_ID);

  const delegated = graphAccess.resourceAccess.find(a => a.id === GROUP_MEMBER_READ_ALL_DELEGATED_ID);
  assert.ok(delegated, 'GroupMember.Read.All delegated permission must be declared');
  assert.equal(delegated.type, 'Scope');

  const application = graphAccess.resourceAccess.find(a => a.id === GROUP_READ_ALL_APPLICATION_ID);
  assert.ok(application, 'Group.Read.All application permission must be declared');
  assert.equal(application.type, 'Role');
});

test('application payload rejects an invalid display name the same way validateDisplayName does', () => {
  assert.throws(() => buildApplicationPayload({ displayName: '', redirectUri: 'https://api.example.com/cb' }), /must not be empty/);
});

test('secret payload spans the requested number of months', () => {
  const payload = buildSecretPayload({ displayName: 'test-secret', monthsValid: 24 });
  const start = new Date(payload.passwordCredential.startDateTime);
  const end = new Date(payload.passwordCredential.endDateTime);
  const monthsApart = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  assert.equal(monthsApart, 24);
  assert.equal(payload.passwordCredential.displayName, 'test-secret');
});

test('classifies device-code polling responses', () => {
  assert.equal(classifyDeviceCodeError({ error: 'authorization_pending' }), 'pending');
  assert.equal(classifyDeviceCodeError({ error: 'slow_down' }), 'slow_down');
  assert.equal(classifyDeviceCodeError({ error: 'expired_token' }), 'expired');
  assert.equal(classifyDeviceCodeError({ error: 'authorization_declined' }), 'declined');
  assert.equal(classifyDeviceCodeError({ error: 'invalid_grant' }), 'fatal');
  assert.equal(classifyDeviceCodeError({}), 'fatal');
});

test('admin consent URL targets the v2 endpoint with the app\'s own redirect URI and a .default scope', () => {
  const url = new URL(adminConsentUrl({
    tenantId: 'tenant-id',
    clientId: 'client-id',
    redirectUri: 'https://api.example.com/v1/auth/microsoft/callback',
  }));
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.pathname, '/tenant-id/v2.0/adminconsent');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.example.com/v1/auth/microsoft/callback');
  assert.equal(url.searchParams.get('scope'), 'https://graph.microsoft.com/.default');
});
