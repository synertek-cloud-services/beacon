#!/usr/bin/env node
/**
 * Build, sign, and publish a new agent version to the Beacon worker.
 *
 * Prerequisites:
 *   - BEACON_SIGNING_KEY env var set to the hex private key from tools/keygen
 *   - BEACON_WORKER_URL env var set (e.g. https://beacon.example.com or http://localhost:8787)
 *   - BEACON_ADMIN_SECRET env var set
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

if (!workerUrl || !adminSecret || !signingKey) {
  console.error('Required env vars: BEACON_WORKER_URL, BEACON_ADMIN_SECRET, BEACON_SIGNING_KEY');
  process.exit(1);
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

  // The download URL points to wherever you're hosting binaries.
  // For local testing this is a placeholder; replace with your CDN/R2/S3 URL.
  const downloadUrl = `${workerUrl}/dist/${outName}`;

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
