import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  // Manually-entered — no OS/hardware API exposes OEM warranty status, so
  // there's no agent collector for this the way there is for other System
  // fields. A real auto-lookup would need per-vendor API integrations.
  warrantyExpiresAt: integer('warranty_expires_at'),
  // Captured from the check-in request's own CF-Connecting-IP header — not
  // agent-collected (no agent-side way to learn its own public IP).
  externalIp: text('external_ip'),
  // Maintenance window — alerts are suppressed until this timestamp. Null means
  // not in maintenance. Set via the dashboard; cleared when the window expires
  // or is manually ended.
  maintenanceEndsAt: integer('maintenance_ends_at'),
  maintenanceReason: text('maintenance_reason'),
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

export const policies = sqliteTable('policies', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  description: text('description'),
  scope:       text('scope', { enum: ['global', 'company'] }).notNull().default('global'),
  companyId:   text('company_id').references(() => tenants.id),
  enabled:     integer('enabled', { mode: 'boolean' }).notNull().default(true),
  targetOs:    text('target_os').notNull().default('["windows","linux","macos"]'),
  targetClass: text('target_class').notNull().default('["server","workstation","laptop"]'),
  createdAt:   integer('created_at').notNull(),
  updatedAt:   integer('updated_at').notNull(),
});

export const policyMonitors = sqliteTable('policy_monitors', {
  id:                      text('id').primaryKey(),
  policyId:                text('policy_id').notNull().references(() => policies.id),
  checkType:               text('check_type', { enum: ['disk_space', 'offline', 'cpu_usage', 'memory_usage', 'av_status', 'file_size', 'ping', 'process', 'service', 'software'] }).notNull(),
  enabled:                 integer('enabled', { mode: 'boolean' }).notNull().default(true),
  config:                  text('config').notNull().default('{}'),
  alertPriority:           text('alert_priority', { enum: ['critical', 'high', 'moderate', 'low'] }).notNull().default('high'),
  sustainedMinutes:        integer('sustained_minutes').notNull().default(5),
  checkIntervalMinutes:    integer('check_interval_minutes').notNull().default(1),
  autoResolve:             integer('auto_resolve', { mode: 'boolean' }).notNull().default(true),
  autoResolveAfterMinutes: integer('auto_resolve_after_minutes').notNull().default(60),
  createdAt:               integer('created_at').notNull(),
});

// Policy targeting via Device Groups -- zero rows for a policy means
// unchanged scope/OS/class-only behavior; see deviceMatchesPolicy in
// worker/src/lib/alerts.ts for how this is evaluated.
export const policyGroups = sqliteTable('policy_groups', {
  policyId:  text('policy_id').notNull().references(() => policies.id, { onDelete: 'cascade' }),
  groupId:   text('group_id').notNull().references(() => deviceGroups.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.policyId, t.groupId] })]);

export const alertState = sqliteTable('alert_state', {
  id:                 text('id').primaryKey(),
  deviceId:           text('device_id').notNull().references(() => devices.id),
  policyMonitorId:    text('policy_monitor_id').notNull().references(() => policyMonitors.id),
  conditionFirstSeen: integer('condition_first_seen'),
  isAlerting:         integer('is_alerting', { mode: 'boolean' }).notNull().default(false),
  alertedAt:          integer('alerted_at'),
  resolvedAt:         integer('resolved_at'),
  acknowledgedAt:     integer('acknowledged_at'),
  acknowledgedBy:     text('acknowledged_by'),
  updatedAt:          integer('updated_at').notNull(),
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
  // sha256hex of a per-session random token — the WS client leg's credential.
  // No longer the shared ADMIN_SECRET, since non-break-glass users don't hold it.
  clientAuthHash: text('client_auth_hash'),
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
  category:       text('category'), // freeform organizational tag — surfaced in the UI as "Group", not to be confused with `type`
  type:           text('type', { enum: ['script', 'application'] }).notNull().default('script'),
  origin:         text('origin', { enum: ['custom', 'store'] }).notNull().default('custom'),
  // "Sites" scoping — 'global' means usable everywhere; 'company' means
  // restricted to the sites listed in component_sites (a real many-to-many,
  // not a single company — see that table for the actual membership list).
  scope:          text('scope', { enum: ['global', 'company'] }).notNull().default('global'),
  // Vestigial — superseded by component_sites (0022) before this ever saw
  // real usage. No longer read or written; kept only because the physical
  // column exists and D1's SQLite doesn't make DROP COLUMN worth it here.
  companyId:      text('company_id').references(() => tenants.id),
  shell:          text('shell').notNull().default('auto'),
  script:         text('script').notNull().default(''),
  timeoutSeconds: integer('timeout_seconds').notNull().default(300),
  postConditions: text('post_conditions').notNull().default('[]'), // JSON PostCondition[]
  targetOs:       text('target_os'), // null = all platforms; 'windows'|'linux'|'darwin' = OS-specific
  createdAt:      integer('created_at').notNull(),
  updatedAt:      integer('updated_at').notNull(),
});

export const componentVariables = sqliteTable('component_variables', {
  id:            text('id').primaryKey(),
  componentId:   text('component_id').notNull().references(() => components.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  label:         text('label').notNull(),
  type:          text('type', { enum: ['string', 'selection', 'boolean', 'date'] }).notNull().default('string'),
  options:       text('options'),       // JSON [{label,value}] — only for type='selection'
  defaultValue:  text('default_value'), // always a string, regardless of declared type
  description:   text('description'),
  required:      integer('required', { mode: 'boolean' }).notNull().default(true),
  sortOrder:     integer('sort_order').notNull().default(0),
  createdAt:     integer('created_at').notNull(),
});

// Multi-site "Sites" membership for company-scoped components — a component
// can be restricted to several sites at once, added/removed one at a time
// (mirrors Datto's "Add Site" flyout).
export const componentSites = sqliteTable('component_sites', {
  id:          text('id').primaryKey(),
  componentId: text('component_id').notNull().references(() => components.id, { onDelete: 'cascade' }),
  tenantId:    text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt:   integer('created_at').notNull(),
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

// --- Auth: local accounts + Microsoft Entra ID SSO, global RBAC roles ---

export const ssoProviders = sqliteTable('sso_providers', {
  id:                     text('id').primaryKey(),
  type:                   text('type', { enum: ['microsoft'] }).notNull().default('microsoft'), // 'google' reserved (v2)
  name:                   text('name').notNull(),
  directoryId:            text('directory_id').notNull(), // Entra directory (tenant) id — NOT Beacon's own `tenants`
  clientId:               text('client_id').notNull(),
  clientSecretCiphertext: text('client_secret_ciphertext').notNull(), // AES-GCM ciphertext, base64
  clientSecretNonce:      text('client_secret_nonce').notNull(),      // AES-GCM 12-byte nonce, base64
  enabled:                integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt:              integer('created_at').notNull(),
  updatedAt:              integer('updated_at').notNull(),
});

export const ssoGroupRoleMappings = sqliteTable('sso_group_role_mappings', {
  id:            text('id').primaryKey(),
  ssoProviderId: text('sso_provider_id').notNull().references(() => ssoProviders.id),
  groupId:       text('group_id').notNull(), // Entra security group object id
  groupName:     text('group_name'),         // cached display name, cosmetic only
  role:          text('role', { enum: ['admin', 'technician', 'readonly'] }).notNull(),
  createdAt:     integer('created_at').notNull(),
});

// Short-lived, single-use CSRF/PKCE state for the OAuth redirect. id IS the `state`
// value sent to Microsoft — no server-side session exists yet at this point in the flow.
export const ssoLoginState = sqliteTable('sso_login_state', {
  id:            text('id').primaryKey(),
  ssoProviderId: text('sso_provider_id').notNull().references(() => ssoProviders.id),
  codeVerifier:  text('code_verifier').notNull(), // PKCE
  redirectUri:   text('redirect_uri').notNull(),
  createdAt:     integer('created_at').notNull(),
  expiresAt:     integer('expires_at').notNull(),
});

export const users = sqliteTable('users', {
  id:            text('id').primaryKey(),
  email:         text('email').notNull(),
  displayName:   text('display_name'),
  role:          text('role', { enum: ['admin', 'technician', 'readonly'] }).notNull().default('readonly'),
  // Self-describing: "pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>". NULL for SSO-only users.
  passwordHash:  text('password_hash'),
  authSource:    text('auth_source', { enum: ['local', 'microsoft'] }).notNull().default('local'),
  ssoProviderId: text('sso_provider_id').references(() => ssoProviders.id),
  ssoSubject:    text('sso_subject'), // Entra object id (`oid` claim); NULL for local accounts
  status:        text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  createdAt:     integer('created_at').notNull(),
  updatedAt:     integer('updated_at').notNull(),
  lastLoginAt:   integer('last_login_at'),
  createdBy:     text('created_by'),
});

export const userSessions = sqliteTable('user_sessions', {
  id:          text('id').primaryKey(),
  userId:      text('user_id').notNull().references(() => users.id),
  // sha256hex(raw token) — same convention as enrollmentTokens.tokenHash / devices.deviceCredentialHash
  tokenHash:   text('token_hash').notNull().unique(),
  createdAt:   integer('created_at').notNull(),
  expiresAt:   integer('expires_at').notNull(),
  lastUsedAt:  integer('last_used_at'),
  revokedAt:   integer('revoked_at'),
  userAgent:   text('user_agent'),
  ip:          text('ip'),
});

// One-time code handed to the SPA after an SSO login so the real session token never
// appears in a URL. The SPA immediately POSTs it to /v1/auth/microsoft/exchange.
export const ssoExchangeCodes = sqliteTable('sso_exchange_codes', {
  id:           text('id').primaryKey(),
  sessionToken: text('session_token').notNull(), // raw (unhashed), single-use, ~60s TTL
  createdAt:    integer('created_at').notNull(),
  expiresAt:    integer('expires_at').notNull(),
});

export const commands = sqliteTable('commands', {
  id:             text('id').primaryKey(),
  deviceId:       text('device_id').notNull().references(() => devices.id),
  tenantId:       text('tenant_id').notNull().references(() => tenants.id),
  type:           text('type').notNull(),
  payload:        text('payload').notNull(), // JSON
  status:         text('status', { enum: ['queued', 'sent', 'completed', 'failed'] }).notNull().default('queued'),
  result:         text('result'), // JSON: { stdout, stderr, exit_code }
  warning:        integer('warning', { mode: 'boolean' }).notNull().default(false), // post_conditions match — orthogonal to status
  createdAt:      integer('created_at').notNull(),
  completedAt:    integer('completed_at'),
  // Job linkage (null for direct commands like reboot)
  jobId:          text('job_id'),
  componentId:    text('component_id'),
  componentOrder: integer('component_order').notNull().default(1),
});

// Dynamic custom fields ("UDF" equivalent) — admin-defined named fields, values
// stored per device. Not Datto's 300 fixed numbered slots; a real join table
// (not a JSON blob on devices) so a future filter/targeting pass doesn't need
// a schema change. Manual entry only for this pass — no agent-write path.
export const customFields = sqliteTable('custom_fields', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  // Identifier form of `name` (uppercase, [A-Z_][A-Z0-9_]*) -- lets a script
  // reference this field's value as the env var CF_<key>, resolved per-device
  // at job dispatch time. '' means no key assigned yet (not referenceable).
  key:       text('key').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const deviceCustomFieldValues = sqliteTable('device_custom_field_values', {
  deviceId:  text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  fieldId:   text('field_id').notNull().references(() => customFields.id, { onDelete: 'cascade' }),
  value:     text('value'),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.fieldId] })]);

// Device Groups -- static, manually-curated device collections (Datto's
// "Groups", not the dynamic "Filter" half of that system). Used to target
// both Jobs (resolveDevices in jobs.ts) and Policies (policyGroups below).
export const deviceGroups = sqliteTable('device_groups', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  description: text('description'),
  createdAt:   integer('created_at').notNull(),
  updatedAt:   integer('updated_at').notNull(),
});

export const deviceGroupMembers = sqliteTable('device_group_members', {
  groupId:   text('group_id').notNull().references(() => deviceGroups.id, { onDelete: 'cascade' }),
  deviceId:  text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.deviceId] })]);
