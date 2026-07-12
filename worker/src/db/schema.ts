import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  autoApproveDefault: integer('auto_approve_default', { mode: 'boolean' }).notNull().default(true),
  privacyModeDefault: integer('privacy_mode_default', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  // Contact
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  // Business
  website: text('website'),
  notes: text('notes'),
  // Address stored as JSON: { street, city, state, zip, country }
  address: text('address'),
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

export const agentVersions = sqliteTable('agent_versions', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  os: text('os').notNull(),   // 'windows' | 'linux' | 'darwin'
  arch: text('arch').notNull(), // 'amd64' | 'arm64'
  downloadUrl: text('download_url').notNull(),
  signatureHex: text('signature_hex').notNull(), // hex-encoded Ed25519 sig over SHA-256 of binary
  publishedAt: integer('published_at').notNull(),
  isLatest: integer('is_latest', { mode: 'boolean' }).notNull().default(false),
});

export const tenantContacts = sqliteTable('tenant_contacts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  title: text('title'),
  email: text('email'),
  phone: text('phone'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const tenantLocations = sqliteTable('tenant_locations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  street: text('street'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  country: text('country'),
  createdAt: integer('created_at').notNull(),
});

export const webhookEndpoints = sqliteTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  url: text('url').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

export const alertDefinitions = sqliteTable('alert_definitions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  // null = applies to all devices in tenant; set to scope to one device
  deviceId: text('device_id').references(() => devices.id),
  // null = applies to all device classes; set to scope by class
  deviceClass: text('device_class', { enum: ['server', 'workstation', 'laptop'] }),
  checkType: text('check_type', { enum: ['disk_space', 'offline', 'cpu_usage', 'memory_usage', 'av_status'] }).notNull(),
  threshold: text('threshold').notNull(), // JSON — shape varies by check_type
  consecutiveFailuresRequired: integer('consecutive_failures_required').notNull().default(3),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: text('priority', { enum: ['critical', 'high', 'moderate', 'low'] }).notNull().default('high'),
  createdAt: integer('created_at').notNull(),
});

export const alertState = sqliteTable('alert_state', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => devices.id),
  alertDefinitionId: text('alert_definition_id').notNull().references(() => alertDefinitions.id),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  isAlerting: integer('is_alerting', { mode: 'boolean' }).notNull().default(false),
  alertedAt: integer('alerted_at'),   // when the alert first fired
  resolvedAt: integer('resolved_at'), // when it last resolved
  updatedAt: integer('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => devices.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  sessionType: text('session_type', { enum: ['shell', 'tcp_tunnel'] }).notNull(),
  tcpPort: integer('tcp_port'), // for tcp_tunnel
  status: text('status', { enum: ['pending', 'active', 'closed'] }).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  closedAt: integer('closed_at'),
});

export const deviceAudits = sqliteTable('device_audits', {
  id:           text('id').primaryKey(),
  deviceId:     text('device_id').notNull().references(() => devices.id),
  tenantId:     text('tenant_id').notNull().references(() => tenants.id),
  auditType:    text('audit_type').notNull().default('full'),
  hardware:     text('hardware'),   // JSON blob
  software:     text('software'),   // JSON blob
  services:     text('services'),   // JSON blob
  security:     text('security'),   // JSON blob
  agentVersion: text('agent_version'),
  createdAt:    integer('created_at').notNull(),
});

export const deviceAuditChanges = sqliteTable('device_audit_changes', {
  id:         text('id').primaryKey(),
  deviceId:   text('device_id').notNull().references(() => devices.id),
  tenantId:   text('tenant_id').notNull().references(() => tenants.id),
  auditId:    text('audit_id').notNull().references(() => deviceAudits.id),
  category:   text('category').notNull(),
  changeType: text('change_type').notNull(),
  itemName:   text('item_name').notNull(),
  field:      text('field'),
  oldValue:   text('old_value'),
  newValue:   text('new_value'),
  detectedAt: integer('detected_at').notNull(),
});

export const components = sqliteTable('components', {
  id:             text('id').primaryKey(),
  name:           text('name').notNull(),
  description:    text('description'),
  category:       text('category'),
  type:           text('type', { enum: ['script', 'application'] }).notNull().default('script'),
  shell:          text('shell').notNull().default('auto'),
  script:         text('script').notNull().default(''),
  timeoutSeconds: integer('timeout_seconds').notNull().default(300),
  createdAt:      integer('created_at').notNull(),
  updatedAt:      integer('updated_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  description:  text('description'),
  type:         text('type', { enum: ['quick', 'scheduled'] }).notNull().default('quick'),
  status:       text('status', { enum: ['active', 'completed', 'cancelled'] }).notNull().default('active'),
  componentIds: text('component_ids').notNull().default('[]'), // JSON
  targetType:   text('target_type').notNull().default('devices'),
  targetIds:    text('target_ids').notNull().default('[]'),    // JSON
  runAsSystem:  integer('run_as_system', { mode: 'boolean' }).notNull().default(true),
  scheduledAt:  integer('scheduled_at'),
  expiresAt:    integer('expires_at'),
  createdAt:    integer('created_at').notNull(),
  createdBy:    text('created_by'),
});

export const commands = sqliteTable('commands', {
  id:             text('id').primaryKey(),
  deviceId:       text('device_id').notNull().references(() => devices.id),
  tenantId:       text('tenant_id').notNull().references(() => tenants.id),
  type:           text('type').notNull(),
  payload:        text('payload').notNull(), // JSON
  status:         text('status', { enum: ['queued', 'sent', 'completed', 'failed'] }).notNull().default('queued'),
  result:         text('result'), // JSON: { stdout, stderr, exit_code }
  createdAt:      integer('created_at').notNull(),
  completedAt:    integer('completed_at'),
  // Job linkage (null for direct commands like reboot)
  jobId:          text('job_id'),
  componentId:    text('component_id'),
  componentOrder: integer('component_order').notNull().default(1),
});
