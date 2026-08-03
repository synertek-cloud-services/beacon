import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClearSql, buildRestoreDataSql, parseTableDependencies } from './lib/d1-restore.mjs';

const schema = `CREATE TABLE "children" (
  "id" text PRIMARY KEY,
  "parent_id" text NOT NULL REFERENCES "parents"("id"),
  "payload" text
);
CREATE TABLE IF NOT EXISTS "parents" (
  "id" text PRIMARY KEY
);
CREATE TABLE "inline_table" ("id" text PRIMARY KEY);
`;

test('orders parent rows before exported child rows', () => {
  const data = `PRAGMA defer_foreign_keys=TRUE;
INSERT INTO "children" ("id","parent_id","payload") VALUES('child','parent','small');
INSERT INTO "parents" ("id") VALUES('parent');
`;
  const result = buildRestoreDataSql(schema, data);
  assert.ok(result.sql.indexOf('INSERT INTO "parents"') < result.sql.indexOf('INSERT INTO "children"'));
  assert.equal(result.tableCount, 2);
  assert.equal(result.oversizedRows, 0);
});

test('splits an oversized string into import-safe updates', () => {
  const payload = `prefix-${'🙂'.repeat(150)}-'quoted'`;
  const escaped = payload.replaceAll("'", "''");
  const data = `INSERT INTO "parents" ("id") VALUES('parent');\n`
    + `INSERT INTO "children" ("id","parent_id","payload") VALUES('child','parent','${escaped}');\n`;
  const result = buildRestoreDataSql(schema, data, { maxStatementBytes: 200, chunkBytes: 80 });
  assert.equal(result.oversizedRows, 1);
  assert.match(result.sql, /VALUES\('child','parent',''\);/);
  assert.match(result.sql, /SET "payload" = "payload" \|\|/);
  assert.ok(Math.max(...result.sql.split('\n').map(line => Buffer.byteLength(line))) < 200);
});

test('builds a transactional clear for every exported table', () => {
  const clear = buildClearSql(schema);
  assert.match(clear, /PRAGMA defer_foreign_keys=TRUE/);
  assert.match(clear, /DELETE FROM "children"/);
  assert.match(clear, /DELETE FROM "parents"/);
  assert.match(clear, /DELETE FROM "inline_table"/);
});

test('parses foreign-key dependencies without retaining self references', () => {
  const dependencies = parseTableDependencies(schema);
  assert.deepEqual([...dependencies.get('children')], ['parents']);
  assert.deepEqual([...dependencies.get('parents')], []);
  assert.deepEqual([...dependencies.get('inline_table')], []);
});
