#!/usr/bin/env node
/**
 * Build, sign, publish, and verify a new agent version.
 *
 * Required env vars:
 *   BEACON_SIGNING_KEY   — hex Ed25519 private key (from tools/keygen, in password manager)
 *   BEACON_WORKER_URL    — worker base URL (e.g. https://rmm-api.cloud.synertekcs.com)
 *   BEACON_ADMIN_SECRET  — worker admin secret
 *
 * Usage (export + run in a single command to prevent direnv from resetting env between prompts):
 *   export BEACON_SIGNING_KEY=<key> BEACON_WORKER_URL=<url> BEACON_ADMIN_SECRET=<secret> && \
 *     node scripts/publish-agent.mjs 0.2.9
 *
 * What it does:
 *   1. Builds all 5 platform binaries with -trimpath (reproducible across machines/dirs)
 *   2. Creates (or reuses) a GitHub release vX.Y.Z and uploads the binaries
 *   3. Signs each binary with the Ed25519 key
 *   4. Registers each with the worker via POST /v1/admin/agent/versions
 *   5. Verifies the registered signature by re-downloading from GitHub and re-checking
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const rootDir = resolve(fileURLToPath(import.meta.url), '../..');
const agentDir = join(rootDir, 'agent');
const distDir  = join(rootDir, 'dist');

const version = process.argv[2];
if (!version) {
  console.error('usage: publish-agent.mjs <version>');
  process.exit(1);
}

const workerUrl   = process.env.BEACON_WORKER_URL;
const adminSecret = process.env.BEACON_ADMIN_SECRET;
const signingKey  = process.env.BEACON_SIGNING_KEY;

if (!workerUrl || !adminSecret || !signingKey) {
  console.error('Required: BEACON_WORKER_URL, BEACON_ADMIN_SECRET, BEACON_SIGNING_KEY');
  process.exit(1);
}

const targets = [
  { os: 'linux',   arch: 'amd64' },
  { os: 'linux',   arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
  { os: 'darwin',  arch: 'amd64' },
  { os: 'darwin',  arch: 'arm64' },
];

const tag = `v${version}`;

// ── Step 1: Build all binaries ──────────────────────────────────────────────

execSync(`mkdir -p ${distDir}`);

for (const { os, arch } of targets) {
  const outName = os === 'windows' ? `beacon-agent-${os}-${arch}.exe` : `beacon-agent-${os}-${arch}`;
  const outPath = join(distDir, outName);
  console.log(`Building ${os}/${arch}…`);
  execSync(
    // -trimpath strips the build machine's absolute paths from the binary so
    // the same source always produces the same bytes regardless of where it's
    // built — this makes signatures reproducible across machines and directories.
    `go build -trimpath -ldflags="-X main.version=${version}" -o ${outPath} ./cmd/agent`,
    { cwd: agentDir, env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' }, stdio: 'inherit' }
  );
}

// ── Step 2: Create GitHub release (idempotent — reuses existing release) ────

const assetNames = targets.map(({ os, arch }) =>
  os === 'windows' ? `beacon-agent-${os}-${arch}.exe` : `beacon-agent-${os}-${arch}`
);

let releaseExists = false;
try {
  execSync(`gh release view ${tag} --json tagName`, { stdio: 'pipe' });
  releaseExists = true;
} catch { /* doesn't exist yet */ }

if (releaseExists) {
  console.log(`\nGitHub release ${tag} already exists — uploading/overwriting assets…`);
  for (const name of assetNames) {
    try {
      execSync(`gh release upload ${tag} ${join(distDir, name)} --clobber`, { stdio: 'inherit' });
    } catch (e) {
      console.error(`Failed to upload ${name}: ${e.message}`);
      process.exit(1);
    }
  }
} else {
  console.log(`\nCreating GitHub release ${tag}…`);
  const assetPaths = assetNames.map(n => join(distDir, n)).join(' ');
  execSync(`gh release create ${tag} ${assetPaths} --title "Agent ${tag}" --notes "Agent ${tag}"`, {
    cwd: rootDir, stdio: 'inherit',
  });
}

const downloadBase = `https://github.com/synertek-cloud-services/beacon/releases/download/${tag}`;

// ── Step 3: Sign, register, and verify each binary ─────────────────────────

for (const { os, arch } of targets) {
  const outName = os === 'windows' ? `beacon-agent-${os}-${arch}.exe` : `beacon-agent-${os}-${arch}`;
  const outPath = join(distDir, outName);

  console.log(`\n[${os}/${arch}] Signing…`);
  const sigResult = spawnSync('go', ['run', './tools/sign', outPath], {
    cwd: agentDir, env: { ...process.env, BEACON_SIGNING_KEY: signingKey },
  });
  if (sigResult.status !== 0) {
    console.error(sigResult.stderr?.toString());
    process.exit(1);
  }
  const signatureHex = sigResult.stdout.toString().trim();

  const downloadUrl = `${downloadBase}/${outName}`;
  console.log(`[${os}/${arch}] Registering with worker…`);
  const resp = await fetch(`${workerUrl}/v1/admin/agent/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSecret}` },
    body: JSON.stringify({ version, os, arch, download_url: downloadUrl, signature_hex: signatureHex }),
  });
  if (!resp.ok) {
    console.error(`Worker ${resp.status}: ${await resp.text()}`);
    process.exit(1);
  }

  // Verify: re-download from GitHub and re-compute the signature, then compare
  // against what was just registered. Catches key corruption silently — the
  // v0.2.2 incident where a corrupted key signed every binary "successfully"
  // but devices never actually updated.
  console.log(`[${os}/${arch}] Verifying signature against live GitHub asset…`);
  const dl = await fetch(downloadUrl);
  if (!dl.ok) {
    console.error(`  Download failed: ${dl.status} — has the release finished propagating? Retry in a moment.`);
    process.exit(1);
  }
  const bytes = Buffer.from(await dl.arrayBuffer());

  const verify = spawnSync('go', ['run', './tools/verify', '-'], {
    cwd: agentDir,
    env: { ...process.env, BEACON_SIGNATURE_HEX: signatureHex },
    input: bytes,
  });

  // tools/verify may not exist yet — fall back to a SHA-256 sanity check
  if (verify.status === null) {
    const localBytes = readFileSync(outPath);
    const localHash  = createHash('sha256').update(localBytes).digest('hex');
    const remoteHash = createHash('sha256').update(bytes).digest('hex');
    if (localHash !== remoteHash) {
      console.error(`  MISMATCH: local and remote SHA-256 differ for ${outName}`);
      console.error(`  Local:  ${localHash}`);
      console.error(`  Remote: ${remoteHash}`);
      process.exit(1);
    }
    console.log(`  ✓ SHA-256 matches (${localHash.slice(0, 16)}…) — Ed25519 verify skipped (no tools/verify binary)`);
  } else if (verify.status !== 0) {
    console.error(`  SIGNATURE MISMATCH for ${outName}`);
    console.error(verify.stderr?.toString());
    process.exit(1);
  } else {
    console.log(`  ✓ Signature verified`);
  }
}

console.log(`\nDone. Agent ${tag} is live.`);
