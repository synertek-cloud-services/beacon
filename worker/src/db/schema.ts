import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  autoApproveDefault: integer('auto_approve_default', { mode: 'boolean' }).notNull().default(true),
  privacyModeDefault: integer('privacy_mode_default', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
});

export const enrollmentTokens = sqliteTable('enrollment_tokens', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  // SHA-256 of the raw token — never store raw. High-entropy random input
  // makes SHA-256 sufficient here; bcrypt/argon2 not needed.
  tokenHash: text('token_hash').notNull().unique(),
  agentType: text('agent_type', { enum: ['standard', 'discovery_probe'] }).notNull().default('standard'),
  // Nullable — when null, inherits tenants.auto_approve_default at enrollment time.
  autoApprove: integer('auto_approve', { mode: 'boolean' }),
  maxUses: integer('max_uses'), // null = unlimited
  useCount: integer('use_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'), // null = never
  revokedAt: integer('revoked_at'), // null = active
  createdBy: text('created_by').notNull(),
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  enrollmentTokenId: text('enrollment_token_id').notNull().references(() => enrollmentTokens.id),
  agentType: text('agent_type', { enum: ['standard', 'discovery_probe'] }).notNull().default('standard'),
  deviceCredentialHash: text('device_credential_hash').notNull().unique(),
  status: text('status', { enum: ['pending', 'approved', 'revoked'] }).notNull().default('pending'),
  hostname: text('hostname'),
  osType: text('os_type'),
  osVersion: text('os_version'),
  // Recomputed each check-in from OS edition + WMI enclosure/battery signals.
  detectedClass: text('detected_class', { enum: ['server', 'workstation', 'laptop'] }),
  // Set by a human. Sticky — auto-detection never overwrites this once set.
  // Effective class = overrideClass ?? detectedClass.
  overrideClass: text('override_class', { enum: ['server', 'workstation', 'laptop'] }),
  agentVersion: text('agent_version'),
  lastSeen: integer('last_seen'),
  inventory: text('inventory'), // JSON blob — don't normalize until queries require it
  rustdeskId: text('rustdesk_id'), // populated on first on-demand install
  // Inherits tenants.privacy_mode_default when null. Never silently overwritten.
  privacyModeOverride: integer('privacy_mode_override', { mode: 'boolean' }),
  createdAt: integer('created_at').notNull(),
  approvedAt: integer('approved_at'),
});

export const commands = sqliteTable('commands', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => devices.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  type: text('type').notNull(),
  payload: text('payload').notNull(), // JSON
  status: text('status', { enum: ['queued', 'sent', 'completed', 'failed'] }).notNull().default('queued'),
  result: text('result'), // JSON: { stdout, stderr, exit_code }
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
});
