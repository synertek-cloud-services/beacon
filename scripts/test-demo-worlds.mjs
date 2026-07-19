#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLDS, validateWorld, worldNames } from './demo-worlds.mjs';
import { buildWorldSql } from './seed-demo.mjs';

for (const name of worldNames()) {
  const world = WORLDS[name];
  validateWorld(world);
  const sql = buildWorldSql(world);
  assert.doesNotMatch(sql, /undefined/);
  assert.equal((sql.match(/INSERT INTO tenants/g) ?? []).length, world.sites.length);
  assert.equal((sql.match(/INSERT INTO devices/g) ?? []).length, world.devices.length);
  assert.equal((sql.match(/INSERT INTO alert_state/g) ?? []).length, world.incidents.length);
}

console.log(`Validated ${worldNames().length} demo worlds: ${worldNames().join(', ')}`);
