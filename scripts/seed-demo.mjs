#!/usr/bin/env node
/**
 * Seed a deliberately fictional Beacon demo world. This is never a migration:
 * operators choose it explicitly after D1 migrations have been applied.
 */
import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { WORLDS, validateWorld, worldNames } from './demo-worlds.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(root, 'worker');
// Wrangler executes D1 files statement-by-statement, so foreign-key PRAGMAs
// cannot span a reset. This deliberately ordered list drops child tables first.
const resetTables = [
  'user_sessions', 'sso_exchange_codes', 'sso_login_state', 'sso_group_role_mappings',
  'sessions', 'alert_state', 'commands', 'jobs', 'device_audit_changes', 'device_audits',
  'device_custom_field_values', 'device_group_members', 'policy_devices', 'policy_groups',
  'policy_sites', 'component_sites', 'component_variables', 'dashboard_widgets', 'dashboard_sites',
  'device_groups', 'custom_fields', 'policy_monitors', 'policies', 'components', 'webhook_endpoints',
  'tenant_contacts', 'tenant_locations', 'devices', 'enrollment_tokens', 'users', 'sso_providers',
  'branding_settings', 'branding_theme_revisions', 'branding_themes', 'branding_identity', 'dashboards',
  'agent_versions', 'tenants', 'd1_migrations',
];
const resetTableSet = new Set(resetTables);

function usage() {
  console.log(`Usage: node scripts/seed-demo.mjs --world <${worldNames().join('|')}> (--local | --remote --allow-remote) [options]

Options:
  --reset          Rebuild a local D1 database from migrations before seeding.
  --yes            Required with --reset; confirms the destructive local reset.
  --database NAME  D1 binding or database name (default: beacon).
  --persist-to DIR Use a specific local Wrangler persistence directory.

Remote seed operations refuse non-empty databases. Remote reset is never allowed.`);
}

function parseArgs(args) {
  const value = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
  const worldName = value('--world');
  const local = args.includes('--local'), remote = args.includes('--remote');
  if (!worldName || !WORLDS[worldName]) throw new Error(`Choose a world with --world. Available: ${worldNames().join(', ')}`);
  if (local === remote) throw new Error('Choose exactly one target: --local or --remote.');
  if (remote && !args.includes('--allow-remote')) throw new Error('Remote seeding requires --allow-remote and refuses non-empty databases.');
  if (args.includes('--reset') && !local) throw new Error('--reset is local-only. Remote databases are never reset by this tool.');
  if (args.includes('--reset') && !args.includes('--yes')) throw new Error('--reset is destructive. Re-run with --yes after reviewing the target.');
  return { world: WORLDS[worldName], local, remote, reset: args.includes('--reset'), database: value('--database') ?? 'beacon', persistTo: value('--persist-to') };
}

function d1Execute(options, args, capture = false) {
  const target = options.local ? ['--local'] : ['--remote'];
  if (options.local && options.persistTo) target.push('--persist-to', options.persistTo);
  try {
    const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', options.database, ...target, ...args], {
      cwd: workerDir, encoding: capture ? 'utf8' : undefined, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    return output ?? '';
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(detail || (error instanceof Error ? error.message : String(error)));
  }
}

function temporarySql(sql, fn) {
  const directory = mkdtempSync(join(tmpdir(), 'beacon-demo-world-'));
  const file = join(directory, 'seed.sql');
  try { writeFileSync(file, sql); return fn(file); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function executeSql(options, sql) {
  return temporarySql(sql, file => d1Execute(options, ['--file', file], true));
}

function query(options, sql) {
  const output = d1Execute(options, ['--command', sql, '--json'], true);
  const start = output.indexOf('[');
  if (start < 0) throw new Error(`Wrangler did not return JSON for a seed preflight.\n${output}`);
  return JSON.parse(output.slice(start));
}

function rows(options, sql) {
  const result = query(options, sql);
  return result[0]?.results ?? [];
}

function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function json(value) { return quote(JSON.stringify(value)); }
function id(world, kind, key) { return `demo-${world.id}-${kind}-${key}`; }
function digest() { return createHash('sha256').update(randomBytes(32)).digest('hex'); }
function avState(value) {
  return ({ protected: 'running_up_to_date', outdated: 'running_not_up_to_date', unknown: 'not_detected' })[value] ?? 'unknown';
}
function securityInfo(os, state) {
  const product = os === 'windows' ? 'Microsoft Defender' : os === 'macos' ? 'XProtect' : 'ClamAV';
  return {
    firewall_enabled: true,
    antivirus: [{
      name: state === 'not_detected' ? 'No antivirus detected' : product,
      enabled: state === 'running_up_to_date' || state === 'running_not_up_to_date',
      up_to_date: state === 'running_up_to_date',
    }],
  };
}

export function buildWorldSql(world) {
  validateWorld(world);
  const now = 'unixepoch()';
  const tenantId = new Map(world.sites.map(site => [site.key, id(world, 'tenant', site.key)]));
  const deviceId = new Map(world.devices.map(([key]) => [key, id(world, 'device', key)]));
  const monitorTypes = ['offline', 'cpu_usage', 'disk_space', 'av_status'];
  const policyId = id(world, 'policy', 'operations');
  const monitorId = new Map(monitorTypes.map(type => [type, id(world, 'monitor', type)]));
  const monitorPriority = new Map(world.incidents.map(([, type, priority]) => [type, priority]));
  const sql = [];

  for (const site of world.sites) {
    const tenant = tenantId.get(site.key), token = id(world, 'token', site.key);
    sql.push(`INSERT INTO tenants (id, name, auto_approve_default, privacy_mode_default, status, created_at, website, notes) VALUES (${quote(tenant)}, ${quote(site.name)}, 1, 0, 'active', ${now}, NULL, ${quote(`Fictional ${world.title} demo site.`)});`);
    sql.push(`INSERT INTO tenant_contacts (id, tenant_id, name, title, email, is_primary, created_at) VALUES (${quote(id(world, 'contact', site.key))}, ${quote(tenant)}, ${quote(site.contact)}, 'Operations Contact', ${quote(`${site.key}@demo.invalid`)}, 1, ${now});`);
    sql.push(`INSERT INTO tenant_locations (id, tenant_id, name, is_primary, city, country, created_at) VALUES (${quote(id(world, 'location', site.key))}, ${quote(tenant)}, ${quote(site.location)}, 1, ${quote(site.location)}, 'Fictional', ${now});`);
    sql.push(`INSERT INTO enrollment_tokens (id, tenant_id, token_hash, agent_type, use_count, max_uses, revoked_at, created_at, created_by) VALUES (${quote(token)}, ${quote(tenant)}, ${quote(digest())}, 'standard', 0, 0, ${now}, ${now}, 'demo seed');`);
  }

  for (const [key, site, hostname, role, os, deviceClass, online, seedAvStatus] of world.devices) {
    const device = deviceId.get(key), lastSeen = online ? `${now} - 75` : `${now} - 1800`;
    const avStatus = avState(seedAvStatus);
    const inventory = { av_status: avStatus, hardware: { system: { manufacturer: world.title, model: role }, architecture: 'amd64' }, software: [] };
    sql.push(`INSERT INTO devices (id, tenant_id, enrollment_token_id, agent_type, device_credential_hash, status, hostname, os_type, os_version, detected_class, agent_version, last_seen, inventory, external_ip, created_at, approved_at) VALUES (${quote(device)}, ${quote(tenantId.get(site))}, ${quote(id(world, 'token', site))}, 'standard', ${quote(digest())}, 'approved', ${quote(hostname)}, ${quote(os)}, ${quote(os === 'windows' ? 'Windows 11 24H2' : os === 'macos' ? 'macOS 15' : 'Ubuntu 24.04')}, ${quote(deviceClass)}, '0.2.8-demo', ${lastSeen}, ${json(inventory)}, '198.51.100.${10 + world.devices.findIndex(([deviceKey]) => deviceKey === key)}', ${now} - 86400 * 14, ${now} - 86400 * 14);`);
    sql.push(`INSERT INTO device_audits (id, device_id, tenant_id, audit_type, hardware, software, services, security, agent_version, created_at) VALUES (${quote(id(world, 'audit', key))}, ${quote(device)}, ${quote(tenantId.get(site))}, 'full', ${json(inventory.hardware)}, ${json([{ name: 'Beacon Demo Tools', version: '1.0' }])}, '[]', ${json(securityInfo(os, avStatus))}, '0.2.8-demo', ${now} - 3600);`);
  }

  const fields = [
    ['realm', 'REALM', 'Realm'], ['assignment', 'ASSIGNMENT', 'Assignment'],
  ];
  for (const [key, fieldKey, label] of fields) sql.push(`INSERT INTO custom_fields (id, name, key, sort_order, created_at) VALUES (${quote(id(world, 'field', key))}, ${quote(label)}, ${quote(fieldKey)}, ${fields.findIndex(([field]) => field === key)}, ${now});`);
  for (const [key, site, hostname, role] of world.devices) {
    sql.push(`INSERT INTO device_custom_field_values (device_id, field_id, value, updated_at) VALUES (${quote(deviceId.get(key))}, ${quote(id(world, 'field', 'realm'))}, ${quote(world.title)}, ${now});`);
    sql.push(`INSERT INTO device_custom_field_values (device_id, field_id, value, updated_at) VALUES (${quote(deviceId.get(key))}, ${quote(id(world, 'field', 'assignment'))}, ${quote(role)}, ${now});`);
  }

  for (const group of world.groups) {
    const groupId = id(world, 'group', group.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'));
    sql.push(`INSERT INTO device_groups (id, name, description, created_at, updated_at) VALUES (${quote(groupId)}, ${quote(group.name)}, ${quote(`Fictional ${world.title} demo group.`)}, ${now}, ${now});`);
    for (const key of group.members) sql.push(`INSERT INTO device_group_members (group_id, device_id, created_at) VALUES (${quote(groupId)}, ${quote(deviceId.get(key))}, ${now});`);
  }

  sql.push(`INSERT INTO policies (id, name, description, scope, enabled, target_os, target_class, created_at, updated_at) VALUES (${quote(policyId)}, ${quote(`${world.title} Operations`)}, ${quote('Demo-only monitoring policy.' )}, 'company', 1, '["windows","linux","macos"]', '["server","workstation","laptop"]', ${now}, ${now});`);
  for (const site of world.sites) sql.push(`INSERT INTO policy_sites (policy_id, tenant_id, created_at) VALUES (${quote(policyId)}, ${quote(tenantId.get(site.key))}, ${now});`);
  for (const type of monitorTypes) {
    const config = type === 'offline' ? { direction: 'offline', timeout_minutes: 5 } : type === 'cpu_usage' ? { threshold_percent: 90 } : type === 'disk_space' ? { threshold_gb: 10 } : { av_state: 'not_detected' };
    sql.push(`INSERT INTO policy_monitors (id, policy_id, check_type, enabled, config, alert_priority, sustained_minutes, check_interval_minutes, auto_resolve, auto_resolve_after_minutes, created_at) VALUES (${quote(monitorId.get(type))}, ${quote(policyId)}, ${quote(type)}, 1, ${json(config)}, ${quote(monitorPriority.get(type) ?? 'high')}, 5, 1, 1, 60, ${now});`);
  }
  for (const [key, type, priority, minutesAgo] of world.incidents) sql.push(`INSERT INTO alert_state (id, device_id, policy_monitor_id, condition_first_seen, is_alerting, alerted_at, updated_at) VALUES (${quote(id(world, 'alert', key))}, ${quote(deviceId.get(key))}, ${quote(monitorId.get(type))}, ${now} - ${minutesAgo * 60}, 1, ${now} - ${minutesAgo * 60}, ${now});`);

  const componentId = id(world, 'component', 'health-check');
  const firstDevice = world.devices[0], secondDevice = world.devices[1];
  sql.push(`INSERT INTO components (id, name, description, category, type, origin, scope, shell, script, timeout_seconds, post_conditions, target_os, created_at, updated_at) VALUES (${quote(componentId)}, ${quote(`${world.title} Health Check`)}, 'Demo-only component; never run against production devices.', 'Demo', 'script', 'custom', 'global', 'auto', ${quote('echo Beacon demo health check')}, 60, '[]', NULL, ${now}, ${now});`);
  sql.push(`INSERT INTO jobs (id, name, description, type, status, component_ids, target_type, target_ids, run_as_system, created_at, created_by) VALUES (${quote(id(world, 'job', 'health-check'))}, ${quote(`${world.title} Health Check`)}, 'Seeded job history for the demo.', 'quick', 'active', ${json([componentId])}, 'device', ${json([deviceId.get(firstDevice[0]), deviceId.get(secondDevice[0])])}, 1, ${now} - 1800, 'Demo Operator');`);
  sql.push(`INSERT INTO commands (id, device_id, tenant_id, type, payload, status, result, warning, created_at, completed_at, job_id, component_id, component_order) VALUES (${quote(id(world, 'command', 'success'))}, ${quote(deviceId.get(firstDevice[0]))}, ${quote(tenantId.get(firstDevice[1]))}, 'run_script', ${json({ script: 'echo Beacon demo health check' })}, 'completed', ${json({ stdout: 'Healthy', stderr: '', exit_code: 0 })}, 0, ${now} - 1800, ${now} - 1740, ${quote(id(world, 'job', 'health-check'))}, ${quote(componentId)}, 1);`);
  sql.push(`INSERT INTO commands (id, device_id, tenant_id, type, payload, status, result, warning, created_at, completed_at, job_id, component_id, component_order) VALUES (${quote(id(world, 'command', 'failure'))}, ${quote(deviceId.get(secondDevice[0]))}, ${quote(tenantId.get(firstDevice[1]))}, 'run_script', ${json({ script: 'echo Beacon demo health check' })}, 'failed', ${json({ stdout: '', stderr: 'Demo connectivity failure', exit_code: 1 })}, 0, ${now} - 1800, ${now} - 1740, ${quote(id(world, 'job', 'health-check'))}, ${quote(componentId)}, 1);`);
  return sql.join('\n');
}

function preflightEmpty(options) {
  const [state] = rows(options, 'SELECT (SELECT count(*) FROM tenants) AS tenants, (SELECT count(*) FROM devices) AS devices, (SELECT count(*) FROM jobs) AS jobs, (SELECT count(*) FROM users) AS users');
  if (!state || Object.values(state).some(count => Number(count) > 0)) throw new Error('Refusing to seed a non-empty database. Use --reset --yes for a local-only rebuild, or choose a fresh remote D1 database.');
}

function resetLocal(options) {
  const existing = rows(options, "SELECT name FROM sqlite_master WHERE type = 'table'").map(row => String(row.name));
  const unknown = existing.filter(name => !resetTableSet.has(name) && name !== '_cf_METADATA' && !name.startsWith('sqlite_'));
  if (unknown.length) throw new Error(`Local reset needs an updated dependency order for: ${unknown.join(', ')}. Refusing to partially reset the database.`);
  const sql = resetTables.filter(name => existing.includes(name)).map(name => `DROP TABLE IF EXISTS "${name}";`).join('\n');
  executeSql(options, sql);
  const args = ['migrations', 'apply', options.database, '--local'];
  if (options.persistTo) args.push('--persist-to', options.persistTo);
  try {
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', ...args], { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(detail || (error instanceof Error ? error.message : String(error)));
  }
}

export function run(options) {
  if (options.reset) resetLocal(options);
  preflightEmpty(options);
  executeSql(options, buildWorldSql(options.world));
  const [counts] = rows(options, 'SELECT (SELECT count(*) FROM tenants) AS tenants, (SELECT count(*) FROM devices) AS devices, (SELECT count(*) FROM alert_state WHERE is_alerting = 1) AS alerts, (SELECT count(*) FROM jobs) AS jobs');
  console.log(`\nSeeded ${options.world.title}: ${counts.tenants} sites, ${counts.devices} devices, ${counts.alerts} active alerts, ${counts.jobs} jobs.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { run(parseArgs(process.argv.slice(2))); } catch (error) { console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }
}
