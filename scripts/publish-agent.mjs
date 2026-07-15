#!/usr/bin/env node
/**
 * Build, sign, and publish a new agent version to the Beacon worker.
 *
 * Prerequisites:
 *   - BEACON_SIGNING_KEY env var set to the hex private key from tools/keygen
 *   - BEACON_WORKER_URL env var set (e.g. https://beacon.example.com or http://localhost:8787)
 *   - BEACON_ADMIN_SECRET env var set
 *   - BEACON_DOWNLOAD_BASE_URL env var set to wherever the built binaries are
 *     actually hosted, e.g. a GitHub release's asset base:
 *     https://github.com/<org>/<repo>/releases/download/v<version>
 *     If unset, falls back to a placeholder under BEACON_WORKER_URL that
 *     nothing serves — fine for a dry run, but any agent that tries to
 *     self-update from it will 404. Create the GitHub release with the
 *     built dist/ binaries attached *before* running this script so the
 *     base URL you pass here already resolves.
 *
 * Usage:
 *   node scripts/publish-agent.mjs <version> [os] [arch]
 *
 * Examples:
 *   node scripts/publish-agent.mjs 0.2.0 linux amd64
 *   node scripts/publish-agent.mjs 0.2.0 windows amd64
 *   node scripts/publish-agent.mjs 0.2.0              # builds all platforms
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(fileURLToPath(import.meta.url), '../..');
const agentDir = join(rootDir, 'agent');

const version = process.argv[2];
if (!version) {
  console.error('usage: publish-agent.mjs <version> [os] [arch]');
  process.exit(1);
}

const workerUrl = process.env.BEACON_WORKER_URL;
const adminSecret = process.env.BEACON_ADMIN_SECRET;
const signingKey = process.env.BEACON_SIGNING_KEY;
const downloadBaseUrl = process.env.BEACON_DOWNLOAD_BASE_URL;

if (!workerUrl || !adminSecret || !signingKey) {
  console.error('Required env vars: BEACON_WORKER_URL, BEACON_ADMIN_SECRET, BEACON_SIGNING_KEY');
  process.exit(1);
}
if (!downloadBaseUrl) {
  console.warn(
    'WARNING: BEACON_DOWNLOAD_BASE_URL not set — falling back to a placeholder ' +
    'download_url that nothing serves. Any agent that sees update_available=true ' +
    'will 404 trying to fetch it. Set BEACON_DOWNLOAD_BASE_URL to a GitHub release ' +
    'asset base (e.g. https://github.com/<org>/<repo>/releases/download/v<version>) ' +
    'once that release exists.'
  );
}

const targets = process.argv[4]
  ? [{ os: process.argv[3], arch: process.argv[4] }]
  : [
      { os: 'linux',   arch: 'amd64' },
      { os: 'linux',   arch: 'arm64' },
      { os: 'windows', arch: 'amd64' },
      { os: 'darwin',  arch: 'amd64' },
      { os: 'darwin',  arch: 'arm64' },
    ];

for (const { os, arch } of targets) {
  const outName = os === 'windows' ? `beacon-agent-${os}-${arch}.exe` : `beacon-agent-${os}-${arch}`;
  const outPath = join(rootDir, 'dist', outName);

  console.log(`\nBuilding ${os}/${arch} → dist/${outName}`);
  execSync(`mkdir -p ${join(rootDir, 'dist')}`);
  execSync(
    `go build -ldflags="-X main.version=${version}" -o ${outPath} ./cmd/agent`,
    { cwd: agentDir, env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' }, stdio: 'inherit' }
  );

  console.log(`Signing ${outName}…`);
  const sigResult = spawnSync(
    'go', ['run', './tools/sign', outPath],
    { cwd: agentDir, env: { ...process.env, BEACON_SIGNING_KEY: signingKey } }
  );
  if (sigResult.status !== 0) {
    console.error(sigResult.stderr?.toString());
    process.exit(1);
  }
  const signatureHex = sigResult.stdout.toString().trim();
  console.log(`Signature: ${signatureHex.slice(0, 16)}…`);

  // Real hosting (e.g. a GitHub release asset) if BEACON_DOWNLOAD_BASE_URL is
  // set; otherwise the same dead placeholder this script always used to fall
  // back to silently.
  const downloadUrl = downloadBaseUrl ? `${downloadBaseUrl}/${outName}` : `${workerUrl}/dist/${outName}`;

  console.log(`Registering version ${version} (${os}/${arch}) with worker…`);
  const body = JSON.stringify({ version, os, arch, download_url: downloadUrl, signature_hex: signatureHex });
  const resp = await fetch(`${workerUrl}/v1/admin/agent/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSecret}` },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Worker returned ${resp.status}: ${text}`);
    process.exit(1);
  }
  const result = await resp.json();
  console.log(`Published: ${JSON.stringify(result)}`);
}

console.log('\nDone.');
