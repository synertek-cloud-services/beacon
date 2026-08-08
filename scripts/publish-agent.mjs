#!/usr/bin/env node
/**
 * Build, sign, publish, register, and verify a new agent version.
 *
 * Required environment:
 *   BEACON_SIGNING_KEY_FILE — mode-0600 Ed25519 private-key file (recommended),
 *                             or BEACON_SIGNING_KEY for the legacy workflow
 *   BEACON_WORKER_URL       — Worker origin
 *   BEACON_ADMIN_SECRET     — Worker break-glass secret used for registration
 *
 * Optional environment:
 *   BEACON_RELEASE_REPOSITORY — public GitHub repository in owner/repository
 *                               form; otherwise detected from the checkout
 */

import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

import {
  compareVersions,
  normalizeWorkerUrl,
  publicKeyFromSigningKey,
  readSigningKey,
  validateRepository,
  validateVersion,
} from './lib/agent-release.mjs';

const rootDir = resolve(fileURLToPath(import.meta.url), '../..');
const agentDir = join(rootDir, 'agent');
const distDir = join(rootDir, 'dist');
const releaseKeyVariable = 'github.com/synertek-cloud-services/beacon/agent/internal/releasekey.PublicKeyHex';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, options);
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    fail(detail ? `${command} failed: ${detail}` : `${command} failed`);
  }
}

function runGo(args, options = {}) {
  return run('go', args, { cwd: agentDir, stdio: 'inherit', ...options });
}

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let lastResponse;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResponse = await fetch(url, options);
      if (lastResponse.ok || attempt === attempts) return lastResponse;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 3000));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

function detectReleaseRepository(explicitRepository) {
  const args = ['repo', 'view'];
  if (explicitRepository) args.push(validateRepository(explicitRepository));
  args.push('--json', 'nameWithOwner,visibility');

  const raw = run('gh', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const repository = JSON.parse(raw);
  validateRepository(repository.nameWithOwner);
  if (repository.visibility !== 'PUBLIC') {
    fail(`Release repository ${repository.nameWithOwner} is not public; Beacon agents cannot authenticate to private GitHub release assets`);
  }
  return repository.nameWithOwner;
}

const versionArgument = process.argv[2];
if (!versionArgument || process.argv.length !== 3) {
  fail('usage: node scripts/publish-agent.mjs <version>');
}

let version;
let workerUrl;
let signingKey;
try {
  version = validateVersion(versionArgument);
  workerUrl = normalizeWorkerUrl(process.env.BEACON_WORKER_URL ?? '');
  signingKey = readSigningKey({
    keyFile: process.env.BEACON_SIGNING_KEY_FILE,
    keyValue: process.env.BEACON_SIGNING_KEY,
  });
} catch (error) {
  fail(error.message);
}

const adminSecret = process.env.BEACON_ADMIN_SECRET;
if (!adminSecret) fail('BEACON_ADMIN_SECRET is required');

const publicKey = publicKeyFromSigningKey(signingKey);
const releaseRepository = detectReleaseRepository(process.env.BEACON_RELEASE_REPOSITORY);
const releaseKeyLdflag = `-X ${releaseKeyVariable}=${publicKey}`;
const agentLdflags = `-X main.version=${version} ${releaseKeyLdflag}`;

const targets = [
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'darwin', arch: 'arm64' },
];
const tag = `v${version}`;
const assetName = ({ os, arch }) => os === 'windows'
  ? `beacon-agent-${os}-${arch}.exe`
  : `beacon-agent-${os}-${arch}`;

mkdirSync(distDir, { recursive: true });

console.log(`Publishing ${tag} to ${releaseRepository} with a host-controlled update key.`);
console.log('Building beacon-tray.exe (embedded into the Windows agent binary)…');
runGo(
  ['build', '-trimpath', '-ldflags=-H=windowsgui', '-o', 'internal/service/embedded/beacon-tray.exe', './cmd/beacon-tray'],
  { env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } },
);
console.log('Building beacon-screenshare.exe (embedded into the Windows agent binary)…');
runGo(
  ['build', '-trimpath', '-ldflags=-H=windowsgui', '-o', 'internal/session/embedded/beacon-screenshare.exe', './cmd/beacon-screenshare'],
  { env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } },
);

for (const target of targets) {
  const outputPath = join(distDir, assetName(target));
  console.log(`Building ${target.os}/${target.arch}…`);
  runGo(
    ['build', '-trimpath', `-ldflags=${agentLdflags}`, '-o', outputPath, './cmd/agent'],
    { env: { ...process.env, GOOS: target.os, GOARCH: target.arch, CGO_ENABLED: '0' } },
  );
}

const signedReleases = [];
for (const target of targets) {
  const name = assetName(target);
  const outputPath = join(distDir, name);

  console.log(`[${target.os}/${target.arch}] Validating the embedded key and signing…`);
  const signResult = spawnSync(
    'go', ['run', `-ldflags=${releaseKeyLdflag}`, './tools/sign', outputPath],
    {
      cwd: agentDir,
      env: { ...process.env, BEACON_SIGNING_KEY: signingKey },
      encoding: 'utf8',
    },
  );
  if (signResult.status !== 0) {
    fail(signResult.stderr?.trim() || `Signing failed for ${name}`);
  }
  signedReleases.push({
    ...target,
    name,
    outputPath,
    signatureHex: signResult.stdout.trim(),
    downloadUrl: `https://github.com/${releaseRepository}/releases/download/${tag}/${name}`,
  });
}

const catalogResponse = await fetch(`${workerUrl}/v1/admin/agent/versions`, {
  headers: { Authorization: `Bearer ${adminSecret}` },
});
if (!catalogResponse.ok) fail(`Worker release-catalog check failed: HTTP ${catalogResponse.status}`);
const catalog = await catalogResponse.json();

for (const release of signedReleases) {
  const platformRows = catalog.filter(row => row.os === release.os && row.arch === release.arch);
  const sameVersionRows = platformRows.filter(row => row.version === version);
  if (sameVersionRows.some(row =>
    row.downloadUrl !== release.downloadUrl || row.signatureHex !== release.signatureHex
  )) {
    fail(`Worker already contains conflicting metadata for ${version} ${release.os}/${release.arch}; publish a new version`);
  }
  const exactCurrent = sameVersionRows.some(row =>
    row.isLatest
    && row.downloadUrl === release.downloadUrl
    && row.signatureHex === release.signatureHex
  );
  const current = platformRows.find(row => row.isLatest);
  if (!exactCurrent && current && compareVersions(version, current.version) <= 0) {
    fail(`Refusing to replace current ${release.os}/${release.arch} version ${current.version} with ${version}`);
  }
}

let releaseExists = true;
try {
  execFileSync('gh', ['release', 'view', tag, '--repo', releaseRepository, '--json', 'tagName'], {
    cwd: rootDir,
    stdio: 'pipe',
  });
} catch {
  releaseExists = false;
}

const assetPaths = targets.map(target => join(distDir, assetName(target)));
if (releaseExists) {
  console.log(`GitHub release ${tag} already exists — verifying its immutable assets…`);
} else {
  console.log(`Creating GitHub release ${tag}…`);
  const createArgs = [
    'release', 'create', tag, ...assetPaths,
    '--repo', releaseRepository,
    '--title', `Agent ${tag}`,
    '--notes', `Agent ${tag}`,
  ];
  if (version.includes('-')) createArgs.push('--prerelease');
  run('gh', createArgs, { cwd: rootDir, stdio: 'inherit' });
}

const verifiedReleases = [];

for (const release of signedReleases) {
  console.log(`[${release.os}/${release.arch}] Downloading and independently verifying the hosted asset…`);
  const download = await fetchWithRetry(release.downloadUrl);
  if (!download.ok) fail(`Download failed for ${release.name}: HTTP ${download.status}`);
  const hostedBytes = Buffer.from(await download.arrayBuffer());
  const localBytes = readFileSync(release.outputPath);
  const localHash = createHash('sha256').update(localBytes).digest('hex');
  const hostedHash = createHash('sha256').update(hostedBytes).digest('hex');
  if (localHash !== hostedHash) {
    fail(`Immutable hosted bytes do not match the local release build for ${release.name}; publish a new version instead`);
  }

  const verifyResult = spawnSync(
    'go', ['run', `-ldflags=${releaseKeyLdflag}`, './tools/verify', '-'],
    {
      cwd: agentDir,
      env: { ...process.env, BEACON_SIGNATURE_HEX: release.signatureHex },
      input: hostedBytes,
      encoding: 'utf8',
    },
  );
  if (verifyResult.status !== 0) {
    fail(verifyResult.stderr?.trim() || `Signature verification failed for ${release.name}`);
  }
  verifiedReleases.push({ ...release, hostedHash });
}

for (const release of verifiedReleases) {
  const platformRows = catalog.filter(row => row.os === release.os && row.arch === release.arch);
  const sameVersionRows = platformRows.filter(row => row.version === version);
  const exactCurrent = sameVersionRows.some(row =>
    row.isLatest
    && row.downloadUrl === release.downloadUrl
    && row.signatureHex === release.signatureHex
  );
  const conflictingVersion = sameVersionRows.some(row =>
    row.downloadUrl !== release.downloadUrl || row.signatureHex !== release.signatureHex
  );

  if (conflictingVersion) {
    fail(`Worker already contains conflicting metadata for ${version} ${release.os}/${release.arch}; publish a new version`);
  }

  if (exactCurrent) {
    console.log(`[${release.os}/${release.arch}] Identical release is already current — registration skipped.`);
  } else {
    const current = platformRows.find(row => row.isLatest);
    if (current && compareVersions(version, current.version) <= 0) {
      fail(`Refusing to replace current ${release.os}/${release.arch} version ${current.version} with ${version}`);
    }

    console.log(`[${release.os}/${release.arch}] Registering verified release with the Worker…`);
    const response = await fetch(`${workerUrl}/v1/admin/agent/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSecret}`,
      },
      body: JSON.stringify({
        version,
        os: release.os,
        arch: release.arch,
        download_url: release.downloadUrl,
        signature_hex: release.signatureHex,
      }),
    });
    if (!response.ok) fail(`Worker registration failed for ${release.os}/${release.arch}: HTTP ${response.status}`);
  }

  const versionUrl = new URL('/v1/agent/version', workerUrl);
  versionUrl.searchParams.set('os', release.os);
  versionUrl.searchParams.set('arch', release.arch);
  versionUrl.searchParams.set('current', '0.0.0');
  const registeredResponse = await fetch(versionUrl);
  if (!registeredResponse.ok) fail(`Registered version check failed for ${release.os}/${release.arch}: HTTP ${registeredResponse.status}`);
  const registered = await registeredResponse.json();
  if (
    registered.latest_version !== version
    || registered.download_url !== release.downloadUrl
    || registered.signature_hex !== release.signatureHex
  ) {
    fail(`Worker returned unexpected release metadata for ${release.os}/${release.arch}`);
  }

  const agentDownloadUrl = new URL('/v1/agent/download', workerUrl);
  agentDownloadUrl.searchParams.set('os', release.os);
  agentDownloadUrl.searchParams.set('arch', release.arch);
  const agentDownload = await fetch(agentDownloadUrl);
  if (!agentDownload.ok) fail(`Agent download route failed for ${release.os}/${release.arch}: HTTP ${agentDownload.status}`);
  const agentBytes = Buffer.from(await agentDownload.arrayBuffer());
  const agentHash = createHash('sha256').update(agentBytes).digest('hex');
  if (agentHash !== release.hostedHash) fail(`Agent download route returned unexpected bytes for ${release.os}/${release.arch}`);
}

console.log(`Done. Agent ${tag} is published, registered, and independently verified.`);
