import { readFileSync, statSync } from 'fs';

const privateKeyPattern = /^[0-9a-fA-F]{128}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateVersion(value) {
  if (!versionPattern.test(value)) {
    throw new Error('Version must be a semantic version such as 0.3.0 or 0.3.0-beta.1');
  }
  return value;
}

export function compareVersions(left, right) {
  const parse = value => {
    validateVersion(value);
    const buildIndex = value.indexOf('+');
    const withoutBuild = buildIndex === -1 ? value : value.slice(0, buildIndex);
    const prereleaseIndex = withoutBuild.indexOf('-');
    const core = prereleaseIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex);
    const prerelease = prereleaseIndex === -1 ? '' : withoutBuild.slice(prereleaseIndex + 1);
    return {
      core: core.split('.').map(Number),
      prerelease: prerelease === '' ? [] : prerelease.split('.'),
    };
  };

  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]);
    const bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) return Number(a.prerelease[index]) < Number(b.prerelease[index]) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.prerelease[index] < b.prerelease[index] ? -1 : 1;
  }
  return 0;
}

export function parseSigningKey(value) {
  const normalized = value.trim();
  if (!privateKeyPattern.test(normalized)) {
    throw new Error('Agent signing key must contain exactly 64 Ed25519 private-key bytes encoded as hex');
  }
  return normalized.toLowerCase();
}

export function readSigningKey({ keyFile, keyValue }) {
  if (keyFile && keyValue) {
    throw new Error('Set BEACON_SIGNING_KEY_FILE or BEACON_SIGNING_KEY, not both');
  }
  if (!keyFile && !keyValue) {
    throw new Error('Set BEACON_SIGNING_KEY_FILE (recommended) or BEACON_SIGNING_KEY');
  }

  if (keyFile) {
    const info = statSync(keyFile);
    if (!info.isFile()) {
      throw new Error('BEACON_SIGNING_KEY_FILE must name a regular file');
    }
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      throw new Error('BEACON_SIGNING_KEY_FILE must not be accessible by group or other users (expected mode 0600)');
    }
    return parseSigningKey(readFileSync(keyFile, 'utf8'));
  }

  return parseSigningKey(keyValue);
}

// Go's Ed25519 private-key representation is seed (32 bytes) followed by the
// corresponding public key (32 bytes), so the public half can be derived
// without ever invoking a command that prints the private material.
export function publicKeyFromSigningKey(privateKeyHex) {
  return parseSigningKey(privateKeyHex).slice(64);
}

export function validateRepository(value) {
  if (!repositoryPattern.test(value)) {
    throw new Error('Release repository must use the owner/repository form');
  }
  return value;
}

export function normalizeWorkerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BEACON_WORKER_URL must be a valid absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('BEACON_WORKER_URL must use http or https');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BEACON_WORKER_URL must be an origin without a path, query, or fragment');
  }
  return url.origin;
}
