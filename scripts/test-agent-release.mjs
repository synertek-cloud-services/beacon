import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  compareVersions,
  normalizeWorkerUrl,
  parseSigningKey,
  publicKeyFromSigningKey,
  readSigningKey,
  validateRepository,
  validateVersion,
} from './lib/agent-release.mjs';

const privateKey = '01'.repeat(32) + 'ab'.repeat(32);

test('derives the public half from a Go Ed25519 private key', () => {
  assert.equal(publicKeyFromSigningKey(privateKey), 'ab'.repeat(32));
});

test('rejects malformed signing keys without echoing their value', () => {
  assert.throws(() => parseSigningKey('secret-value'), /exactly 64 Ed25519/);
});

test('reads a restricted signing key file', { skip: process.platform === 'win32' }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'beacon-key-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'signing.key');
  writeFileSync(path, `${privateKey}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  assert.equal(readSigningKey({ keyFile: path }), privateKey);

  chmodSync(path, 0o644);
  assert.throws(() => readSigningKey({ keyFile: path }), /expected mode 0600/);
});

test('validates release configuration', () => {
  assert.equal(validateVersion('0.3.0-beta.1'), '0.3.0-beta.1');
  assert.throws(() => validateVersion('v0.3.0; bad'), /semantic version/);
  assert.equal(validateRepository('example/beacon-fork'), 'example/beacon-fork');
  assert.throws(() => validateRepository('https://github.com/example/beacon'), /owner\/repository/);
  assert.equal(normalizeWorkerUrl('https://beacon.example.com/'), 'https://beacon.example.com');
  assert.throws(() => normalizeWorkerUrl('https://beacon.example.com/api'), /without a path/);
});

test('orders semantic versions for downgrade protection', () => {
  assert.equal(compareVersions('0.3.0', '0.3.0-beta.1'), 1);
  assert.equal(compareVersions('0.3.0-beta.2', '0.3.0-beta.10'), -1);
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1);
  assert.equal(compareVersions('0.3.0+build.2', '0.3.0+build.1'), 0);
});
