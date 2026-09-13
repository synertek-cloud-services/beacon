#!/usr/bin/env node
/**
 * Verify and register an upstream Beacon agent release with a fresh host.
 *
 * This never builds or signs an agent. It consumes the public Beacon release
 * artifacts and their detached Ed25519 signatures, so a hosted platform can
 * attach one generic agent channel to many independent Beacon tenants.
 */

import { createHash, verify } from 'crypto';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { compareVersions, normalizeWorkerUrl, validateRepository, validateVersion } from './lib/agent-release.mjs';

const rootDir = resolve(fileURLToPath(import.meta.url), '../..');
const agentDir = join(rootDir, 'agent');
const targets = [
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'darwin', arch: 'arm64' },
];

function fail(message) { console.error(message); process.exit(1); }
function assetName({ os, arch }) { return os === 'windows' ? `beacon-agent-${os}-${arch}.exe` : `beacon-agent-${os}-${arch}`; }

const [versionArgument] = process.argv.slice(2);
if (!versionArgument || process.argv.length !== 3) fail('usage: node scripts/bootstrap-upstream-agent-channel.mjs <version>');

let version;
let workerUrl;
try {
  version = validateVersion(versionArgument);
  workerUrl = normalizeWorkerUrl(process.env.BEACON_WORKER_URL ?? '');
} catch (error) { fail(error.message); }

const adminSecret = process.env.BEACON_ADMIN_SECRET;
if (!adminSecret) fail('BEACON_ADMIN_SECRET is required');
const repository = validateRepository(process.env.BEACON_UPSTREAM_RELEASE_REPOSITORY ?? 'synertek-cloud-services/beacon');
const source = readFileSync(join(agentDir, 'internal/releasekey/releasekey.go'), 'utf8');
const publicKeyHex = source.match(/PublicKeyHex = "([0-9a-f]{64})"/)?.[1];
if (!publicKeyHex) fail('Could not read the upstream agent release key');
const publicKey = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]);

const releaseResponse = await fetch(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'beacon-agent-bootstrap' },
});
if (!releaseResponse.ok) fail(`Upstream release lookup failed: HTTP ${releaseResponse.status}`);
const release = await releaseResponse.json();
if (release.draft) fail('Upstream release is a draft');
const assets = new Map(release.assets.map(asset => [asset.name, asset.browser_download_url]));

for (const target of targets) {
  const name = assetName(target);
  if (!assets.has(name) || !assets.has(`${name}.sig`)) {
    fail(`Upstream release is missing ${name} or its detached signature`);
  }
}

const catalogResponse = await fetch(`${workerUrl}/v1/admin/agent/versions`, { headers: { Authorization: `Bearer ${adminSecret}` } });
if (!catalogResponse.ok) fail(`Worker release-catalog check failed: HTTP ${catalogResponse.status}`);
const catalog = await catalogResponse.json();

for (const target of targets) {
  const name = assetName(target);
  const downloadUrl = assets.get(name);
  const signatureUrl = assets.get(`${name}.sig`);
  const [binaryResponse, signatureResponse] = await Promise.all([fetch(downloadUrl), fetch(signatureUrl)]);
  if (!binaryResponse.ok || !signatureResponse.ok) fail(`Could not download ${name} and its detached signature`);
  const bytes = Buffer.from(await binaryResponse.arrayBuffer());
  const signatureHex = (await signatureResponse.text()).trim();
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) fail(`Invalid detached signature for ${name}`);
  const digest = createHash('sha256').update(bytes).digest();
  if (!verify(null, digest, { key: publicKey, format: 'der', type: 'spki' }, Buffer.from(signatureHex, 'hex'))) {
    fail(`Upstream signature verification failed for ${name}`);
  }

  const platformRows = catalog.filter(row => row.os === target.os && row.arch === target.arch);
  const current = platformRows.find(row => row.isLatest);
  if (current && compareVersions(version, current.version) < 0) fail(`Refusing to downgrade ${target.os}/${target.arch} from ${current.version}`);
  const exact = platformRows.some(row => row.isLatest && row.version === version && row.downloadUrl === downloadUrl && row.signatureHex === signatureHex);
  if (platformRows.some(row => row.version === version && (row.downloadUrl !== downloadUrl || row.signatureHex !== signatureHex))) {
    fail(`Worker already contains conflicting metadata for ${version} ${target.os}/${target.arch}`);
  }
  if (!exact) {
    const response = await fetch(`${workerUrl}/v1/admin/agent/versions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSecret}` },
      body: JSON.stringify({ version, os: target.os, arch: target.arch, download_url: downloadUrl, signature_hex: signatureHex }),
    });
    if (!response.ok) fail(`Worker registration failed for ${target.os}/${target.arch}: HTTP ${response.status}`);
  }
  console.log(`${target.os}/${target.arch}: verified and registered ${version}`);
}

console.log(`Done. Upstream Beacon agent ${version} is available to this host.`);
