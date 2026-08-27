#!/usr/bin/env node
/**
 * Register a Microsoft Entra ID application for Beacon's Entra SSO, end to
 * end: interactive device-code sign-in, app registration, both Graph
 * permissions Beacon's SSO needs, a service principal, and a client secret.
 * Prints the Directory (Tenant) ID / Application (Client) ID / Client Secret
 * to paste into Beacon's Settings -> SSO -- see
 * docs (beacon-docs) "Single Sign-On with Microsoft Entra ID" for that half.
 *
 * This script does not touch Beacon itself and does not grant admin consent
 * on your behalf -- see "Required environment" and the final printed step
 * for why.
 *
 * Required environment:
 *   BEACON_WORKER_URL — Worker/API origin (used to build the OAuth redirect
 *                        URI: <origin>/v1/auth/microsoft/callback -- this is
 *                        your Worker/API origin, never the dashboard URL)
 *
 * Optional environment:
 *   BEACON_SSO_APP_NAME — display name for the Entra app (default "Beacon RMM")
 *
 * You will be asked to sign in interactively via device code as a user with
 * enough Entra privilege to create an app registration -- Application
 * Administrator, Cloud Application Administrator, or Global Administrator.
 * There is no way to bootstrap this without an already-privileged human in
 * the loop; this script automates everything after that sign-in.
 *
 * Deliberately NOT automated: granting admin consent. Doing that
 * programmatically needs additional high-privilege delegated scopes
 * (DelegatedPermissionGrant.ReadWrite.All, AppRoleAssignment.ReadWrite.All)
 * on top of Application.ReadWrite.All, and this script has no way to confirm
 * ahead of time that Azure CLI's borrowed client ID (see below) is even
 * configured to obtain them in your tenant. Rather than fail unpredictably
 * on the single most sensitive step, or silently request more privilege than
 * strictly needed, this script prints a one-click admin-consent link at the
 * end and leaves that approval as a deliberate, visible human action.
 *
 * Sign-in uses Microsoft's own well-known "Azure CLI" public client ID
 * (04b07795-8ddb-461a-bbee-02f9e1bf7b46) to perform the device-code flow --
 * the same technique `az login --use-device-code` and various Azure SDKs'
 * DeviceCodeCredential use. This avoids the chicken-and-egg problem of
 * needing an app registration before you can create an app registration;
 * Microsoft placed no restriction on using this client ID for arbitrary
 * Graph delegated scopes a signed-in user is otherwise entitled to.
 *
 * PARTIALLY VERIFIED. Device-code initiation (this exact client ID, this
 * exact scope, hitting Microsoft's real endpoint) is confirmed live -- it
 * returns a real user code and verification URL. Signing in the rest of the
 * way through app/service-principal/secret creation needs a real Entra
 * tenant and a privileged account, neither available while writing this;
 * every permission GUID and endpoint past that point is cross-checked
 * against Microsoft's own Graph API documentation but not yet exercised
 * end-to-end. Confirm against a real directory before relying on it for a
 * production setup.
 */

import {
  AZURE_CLI_CLIENT_ID,
  adminConsentUrl,
  buildApplicationPayload,
  buildRedirectUri,
  buildSecretPayload,
  classifyDeviceCodeError,
} from './lib/entra-sso.mjs';
import { normalizeWorkerUrl } from './lib/agent-release.mjs';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const DEVICE_CODE_SCOPE = 'https://graph.microsoft.com/Application.ReadWrite.All';
const SECRET_VALID_MONTHS = 24;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function graphFetch(accessToken, path, options = {}) {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = body?.error?.message ?? text;
    throw new Error(`Graph ${options.method ?? 'GET'} ${path} failed (${response.status}): ${detail}`);
  }
  return body;
}

async function requestDeviceCode(tenantSegment) {
  const response = await fetch(`https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: AZURE_CLI_CLIENT_ID, scope: DEVICE_CODE_SCOPE }),
  });
  const body = await response.json();
  if (!response.ok) fail(`Could not start device-code sign-in: ${body.error_description ?? body.error}`);
  return body;
}

async function pollForToken(tenantSegment, deviceCode, intervalSeconds, expiresInSeconds) {
  const deadline = Date.now() + expiresInSeconds * 1000;
  let interval = intervalSeconds;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    const response = await fetch(`https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: AZURE_CLI_CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      }),
    });
    const body = await response.json();
    if (response.ok) return body.access_token;

    switch (classifyDeviceCodeError(body)) {
      case 'pending': continue;
      case 'slow_down': interval += 5; continue;
      case 'expired': fail('Device code expired before sign-in completed. Run this script again.'); break;
      case 'declined': fail('Sign-in was declined.'); break;
      default: fail(`Sign-in failed: ${body.error_description ?? body.error}`);
    }
  }
  fail('Device code expired before sign-in completed. Run this script again.');
}

async function main() {
  let workerOrigin;
  try {
    workerOrigin = normalizeWorkerUrl(process.env.BEACON_WORKER_URL ?? '');
  } catch (error) {
    fail(error.message);
  }
  const redirectUri = buildRedirectUri(workerOrigin);
  const appName = process.env.BEACON_SSO_APP_NAME || 'Beacon RMM';

  console.log(`Redirect URI: ${redirectUri}`);
  console.log(`App display name: ${appName}\n`);

  console.log('Starting interactive sign-in. You need enough Entra privilege to create an');
  console.log('app registration (Application Administrator, Cloud Application Administrator,');
  console.log('or Global Administrator).\n');

  const deviceCode = await requestDeviceCode('organizations');
  console.log(deviceCode.message, '\n');

  const accessToken = await pollForToken(
    'organizations',
    deviceCode.device_code,
    deviceCode.interval ?? 5,
    deviceCode.expires_in ?? 900,
  );
  console.log('Signed in.\n');

  console.log('Looking up your tenant ID...');
  const org = await graphFetch(accessToken, '/organization');
  const tenantId = org.value?.[0]?.id;
  if (!tenantId) fail('Could not determine your tenant ID from Microsoft Graph.');
  console.log(`Tenant ID: ${tenantId}\n`);

  console.log(`Creating app registration "${appName}"...`);
  const application = await graphFetch(accessToken, '/applications', {
    method: 'POST',
    body: JSON.stringify(buildApplicationPayload({ displayName: appName, redirectUri })),
  });
  const clientId = application.appId;
  console.log(`Application (Client) ID: ${clientId}\n`);

  console.log('Creating its service principal (required for sign-in and consent to apply)...');
  await graphFetch(accessToken, '/servicePrincipals', {
    method: 'POST',
    body: JSON.stringify({ appId: clientId }),
  });

  console.log('Creating a client secret...');
  const secret = await graphFetch(accessToken, `/applications/${application.id}/addPassword`, {
    method: 'POST',
    body: JSON.stringify(buildSecretPayload({ displayName: 'beacon-sso-setup', monthsValid: SECRET_VALID_MONTHS })),
  });

  const consentUrl = adminConsentUrl({ tenantId, clientId, redirectUri });

  console.log('\n============================================================');
  console.log('Paste these into Beacon: Settings -> SSO -> Microsoft Entra ID');
  console.log('============================================================');
  console.log(`Directory (Tenant) ID:    ${tenantId}`);
  console.log(`Application (Client) ID:  ${clientId}`);
  console.log(`Client Secret:            ${secret.secretText}`);
  console.log(`  (shown once -- copy it now; Beacon encrypts it at rest and never displays it again)`);
  console.log(`  (valid ${SECRET_VALID_MONTHS} months -- calendar a rotation before it expires)`);
  console.log('\nOne step left, and it has to be a human clicking "Accept" -- this script');
  console.log('deliberately does not grant admin consent on your own behalf (see this');
  console.log('script\'s header comment for why). Open this as a tenant admin:\n');
  console.log(consentUrl);
  console.log('\nAfter accepting, you may land on an error page at your Beacon callback URL --');
  console.log('that\'s expected and harmless; consent has already been recorded by then.');
}

main().catch(error => fail(error.message));
