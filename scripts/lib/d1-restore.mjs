const CREATE_TABLE = /^CREATE TABLE(?: IF NOT EXISTS)? (?:["`]([^"`]+)["`]|([A-Za-z_][A-Za-z0-9_]*))\s*\(/gm;
const INSERT = /^INSERT INTO ["`]([^"`]+)["`] \((.*?)\) VALUES\(([\s\S]*)\);$/;

function splitSqlList(input) {
  const parts = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "'") {
      if (quoted && input[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (input[index] === ',' && !quoted) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted) throw new Error('unterminated SQL string in D1 export');
  parts.push(input.slice(start).trim());
  return parts;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function splitUtf8(value, maxBytes) {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maxBytes && chunk) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function parseTableDependencies(schemaSql) {
  const dependencies = new Map();
  for (const match of schemaSql.matchAll(CREATE_TABLE)) {
    const table = match[1] ?? match[2];
    const open = match.index + match[0].lastIndexOf('(');
    let close = -1;
    let depth = 0;
    let quote = null;
    for (let index = open; index < schemaSql.length; index += 1) {
      const character = schemaSql[index];
      if (quote) {
        if (character === quote) {
          if (schemaSql[index + 1] === quote) index += 1;
          else quote = null;
        }
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) throw new Error(`unterminated CREATE TABLE statement for ${table}`);
    const body = schemaSql.slice(open + 1, close);
    const references = [...body.matchAll(/REFERENCES\s+["`]?(\w+)["`]?/gi)]
      .map(reference => reference[1])
      .filter(reference => reference !== table);
    dependencies.set(table, new Set(references));
  }
  if (dependencies.size === 0) throw new Error('no CREATE TABLE statements found in schema export');
  return dependencies;
}

export function buildClearSql(schemaSql) {
  const tables = [...parseTableDependencies(schemaSql).keys()]
    .filter(table => !table.startsWith('_cf_'));
  return [
    'PRAGMA defer_foreign_keys=TRUE;',
    ...tables.map(table => `DELETE FROM ${quoteIdentifier(table)};`),
    'DELETE FROM sqlite_sequence;',
    '',
  ].join('\n');
}

function orderTables(dependencies, insertTables) {
  const pending = new Set([...dependencies.keys()].filter(table => table !== 'sqlite_sequence'));
  const ordered = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(table =>
      [...(dependencies.get(table) ?? [])].every(parent => !pending.has(parent))
    ).sort();
    if (ready.length === 0) {
      throw new Error(`cyclic table dependencies: ${[...pending].join(', ')}`);
    }
    for (const table of ready) {
      pending.delete(table);
      ordered.push(table);
    }
  }
  for (const table of insertTables) {
    if (!ordered.includes(table) && table !== 'sqlite_sequence') ordered.push(table);
  }
  if (insertTables.has('sqlite_sequence')) ordered.push('sqlite_sequence');
  return ordered;
}

function splitOversizedInsert(line, maxStatementBytes, chunkBytes) {
  if (Buffer.byteLength(line) < maxStatementBytes) return { statements: [line], split: false };
  const match = line.match(INSERT);
  if (!match) throw new Error('could not parse oversized INSERT from D1 export');

  const table = match[1];
  const columns = splitSqlList(match[2]).map(column => column.replace(/^"|"$/g, '').replaceAll('""', '"'));
  const values = splitSqlList(match[3]);
  const idIndex = columns.indexOf('id');
  if (idIndex < 0 || columns.length !== values.length) {
    throw new Error(`oversized INSERT for ${table} lacks a usable id column`);
  }

  const candidates = values.map((value, index) => ({ index, bytes: Buffer.byteLength(value) }))
    .filter(({ index }) => index !== idIndex && values[index].startsWith("'") && values[index].endsWith("'"))
    .sort((a, b) => b.bytes - a.bytes);
  const updates = [];
  const buildInsert = () => `INSERT INTO ${quoteIdentifier(table)} (${match[2]}) VALUES(${values.join(',')});`;
  while (Buffer.byteLength(buildInsert()) >= maxStatementBytes) {
    const candidate = candidates.shift();
    if (!candidate) throw new Error(`oversized INSERT for ${table} had no splittable value`);
    const index = candidate.index;
    const decoded = values[index].slice(1, -1).replaceAll("''", "'");
    values[index] = "''";
    for (const chunk of splitUtf8(decoded, chunkBytes)) {
      updates.push(
        `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(columns[index])} = `
        + `${quoteIdentifier(columns[index])} || ${sqlString(chunk)} WHERE "id" = ${values[idIndex]};`
      );
    }
  }
  if (updates.length === 0) throw new Error(`oversized INSERT for ${table} had no splittable value`);

  const insert = buildInsert();
  if ([insert, ...updates].some(statement => Buffer.byteLength(statement) >= maxStatementBytes)) {
    throw new Error(`could not split oversized INSERT for ${table} below the statement limit`);
  }
  return {
    statements: [insert, ...updates],
    split: true,
  };
}

export function buildRestoreDataSql(schemaSql, dataSql, options = {}) {
  const maxStatementBytes = options.maxStatementBytes ?? 80_000;
  const chunkBytes = options.chunkBytes ?? 40_000;
  const dependencies = parseTableDependencies(schemaSql);
  const inserts = new Map();

  for (const line of dataSql.split('\n')) {
    if (!line.startsWith('INSERT INTO ')) continue;
    const match = line.match(/^INSERT INTO ["`]([^"`]+)["`] /);
    if (!match) throw new Error('could not identify INSERT table in D1 data export');
    const rows = inserts.get(match[1]) ?? [];
    rows.push(line);
    inserts.set(match[1], rows);
  }
  if (inserts.size === 0) throw new Error('no INSERT statements found in data export');

  const ordered = orderTables(dependencies, new Set(inserts.keys()));
  let oversizedRows = 0;
  const statements = [];
  for (const table of ordered) {
    for (const insert of inserts.get(table) ?? []) {
      const result = splitOversizedInsert(insert, maxStatementBytes, chunkBytes);
      if (result.split) oversizedRows += 1;
      statements.push(...result.statements);
    }
  }

  return {
    sql: ['PRAGMA defer_foreign_keys=TRUE;', ...statements, ''].join('\n'),
    tableCount: inserts.size,
    oversizedRows,
  };
}
