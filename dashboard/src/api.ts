const baseUrl = import.meta.env.VITE_API_URL ?? '';
import type { ThemeTokens } from './theme';

function token(): string {
  return sessionStorage.getItem('beacon_emergency_token') ?? localStorage.getItem('beacon_token') ?? '';
}

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { skipAuthRedirect?: boolean }): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    // A 401 outside of a login attempt means the session expired or was revoked —
    // clear it and bounce to /login rather than leaving the page in a broken state.
    if (!opts?.skipAuthRedirect) {
      localStorage.removeItem('beacon_token');
      sessionStorage.removeItem('beacon_emergency_token');
      window.location.hash = '#/login';
    }
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === 'string') message = parsed.error;
    } catch { /* not JSON, fall back to raw text */ }
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────

export interface Summary {
  total: number;
  approved: number;
  pending: number;
  revoked: number;
  online: number;
  offline: number;
  by_os: Record<string, number>;
  by_class: Record<string, number>;
  offline_by_class: Record<string, number>;
  by_av_status: Record<string, number>;
  by_patch_severity: Record<string, number>;
}

export type DashboardWidgetType =
  | 'device_summary' | 'online_offline' | 'os_distribution' | 'class_distribution'
  | 'antivirus_status' | 'offline_by_type' | 'alerts_by_priority' | 'recent_alerts'
  | 'patches_by_severity';

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  title: string | null;
  config: string;
  x: number; y: number; w: number; h: number; sortOrder: number;
}

export interface Dashboard {
  id: string;
  name: string;
  sortOrder: number;
  isHome: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardDetail extends Dashboard {
  companyIds: string[];
  widgets: DashboardWidget[];
}

export interface DashboardData { summary: Summary; alerts: AlertState[] }

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface Company {
  id: string;
  name: string;
  autoApproveDefault: boolean;
  privacyModeDefault: boolean;
  status: 'active' | 'suspended';
  createdAt: number;
  deviceCount: number;
  website: string | null;
  notes: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
}

export interface CompanyContact {
  id: string;
  companyId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: number;
}

export interface CompanyLocation {
  id: string;
  companyId: string;
  name: string;
  isPrimary: boolean;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  createdAt: number;
}

export interface CompanyVariable {
  id: string;
  companyId: string;
  key: string;
  isSecret: boolean;
  // Plain-variable value, present only when !isSecret — a secret's plaintext
  // is never returned by the API once saved.
  value?: string | null;
  hasValue: boolean;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkDiscoveryConfig {
  id: string;
  companyId: string;
  probeDeviceId: string;
  enabled: boolean;
  cidrRanges: string[];
  scanIntervalMinutes: number;
  lastScannedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DiscoveredDevice {
  id: string;
  companyId: string;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  timesSeen: number;
  dismissed: boolean;
}

export interface EnrollmentToken {
  id: string;
  companyId: string;
  autoApprove: boolean | null;
  maxUses: number | null;
  useCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  createdBy: string;
}

export type DeviceStatus = 'pending' | 'approved' | 'revoked';

export type ComponentVariableType = 'string' | 'selection' | 'boolean' | 'date';

export interface ComponentVariableOption {
  label: string;
  value: string;
}

export interface ComponentVariable {
  id: string;
  componentId: string;
  name: string;
  label: string;
  type: ComponentVariableType;
  options: ComponentVariableOption[] | null;
  defaultValue: string | null;
  description: string | null;
  required: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface PostCondition {
  id: string;
  stream: 'stdout' | 'stderr' | 'both';
  match_type: 'contains' | 'regex';
  pattern: string;
  enabled: boolean;
}

export interface ComponentCompany {
  companyId: string;
  name: string;
}

export interface Component {
  id: string;
  name: string;
  description: string | null;
  category: string | null; // freeform organizational tag — shown in the UI as "Group"
  type: 'script' | 'application';
  origin: 'custom' | 'store';
  scope: 'global' | 'company'; // "Companies" scoping — 'company' means restricted to `companies` below (a real multi-company list, not a single company)
  companies: ComponentCompany[];
  shell: string;
  script: string;
  timeoutSeconds: number;
  postConditions: PostCondition[];
  targetOs: string | null; // null = all platforms; 'windows'|'linux'|'darwin' = OS-specific
  variables: ComponentVariable[];
  createdAt: number;
  updatedAt: number;
}

export type ComponentRef =
  | { type: 'library'; component_id: string; order: number; variable_values?: Record<string, string> }
  | { type: 'inline'; shell: string; script: string; timeout_seconds?: number; order: number };

export interface JobDeviceStats {
  queued: number;
  sent: number;
  completed: number;
  failed: number;
  expired: number;
}

export interface Job {
  id: string;
  name: string;
  description: string | null;
  type: 'quick' | 'scheduled';
  status: 'active' | 'completed' | 'cancelled';
  componentIds: string;  // JSON
  targetType: string;
  targetIds: string;     // JSON
  runAsSystem: boolean;
  scheduledAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  createdBy: string | null;
  deviceCount: number;
  deviceStats: JobDeviceStats;
}

export interface JobDeviceCommand {
  id: string;
  componentId: string | null;
  componentName: string | null;
  componentOrder: number;
  status: 'queued' | 'sent' | 'completed' | 'failed' | 'expired';
  result: string | null;
  warning: boolean;
  createdAt: number;
  completedAt: number | null;
}

export interface JobDevice {
  deviceId: string;
  hostname: string | null;
  osType: string | null;
  companyName: string;
  commands: JobDeviceCommand[];
}

export interface JobDetail extends Job {
  devices: JobDevice[];
}

export interface DeviceCommand {
  id: string;
  deviceId: string;
  companyId: string;
  type: string;
  payload: string; // JSON
  status: 'queued' | 'sent' | 'completed' | 'failed';
  result: string | null; // JSON: { stdout, stderr, exit_code }
  createdAt: number;
  completedAt: number | null;
}

export interface ActivityLogEntry {
  id: string;
  createdAt: number;
  actorType: 'user' | 'system' | 'break-glass';
  actorId: string | null;
  actorLabel: string | null;
  category: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  companyId: string | null;
  method: string;
  path: string | null;
  details: string | null; // JSON
}

export interface ActivityLogFilters {
  company_id?: string;
  actor_id?: string;
  category?: string;
  entity_type?: string;
  entity_id?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

// ── Monitor / Alert types ────────────────────────────────────

export type CheckType     = 'disk_space' | 'offline' | 'cpu_usage' | 'memory_usage' | 'av_status' | 'file_size' | 'ping' | 'process' | 'service' | 'software';
export type AlertPriority = 'critical' | 'high' | 'moderate' | 'low';

export interface PolicyMonitor {
  id:                      string;
  policyId:                string;
  checkType:               CheckType;
  enabled:                 boolean;
  config:                  string; // JSON
  alertPriority:           AlertPriority;
  sustainedMinutes:        number;
  checkIntervalMinutes:    number;
  autoResolve:             boolean;
  autoResolveAfterMinutes: number;
  notifyWebhook:           boolean;
  notifyEmail:             boolean;
  createdAt:               number;
}

export interface Policy {
  id:          string;
  name:        string;
  description: string | null;
  // Derived (migration 0032), not directly user-set — 'global' when the
  // policy has zero Targets across companies/devices/groups, 'company' when it
  // has 1+. See deviceMatchesPolicy in worker/src/lib/alerts.ts.
  scope:       'global' | 'company';
  companyId:   string | null; // vestigial — superseded by companyIds below
  enabled:     boolean;
  targetOs:    string; // JSON array
  targetClass: string; // JSON array
  createdAt:   number;
  updatedAt:   number;
  monitors:    PolicyMonitor[];
  // Targets (migration 0032) — a heterogeneous OR-list: a device matches if
  // it satisfies ANY of companyIds/deviceIds/groupIds, not all. Populated by
  // the list endpoint; may be absent elsewhere.
  companyIds?:    string[];
  deviceIds?:  string[];
  groupIds?:   string[];
}

export interface PolicyCompanyTarget {
  companyId: string;
  name:     string;
}

export interface PolicyDeviceTarget {
  deviceId:   string;
  hostname:   string | null;
  companyName: string;
}

// Maintenance Policy (v1: 'one_time'/'weekly' recurrence only — see
// worker/src/lib/maintenance.ts). Targeting is Companies/Devices/Groups only,
// no OS/Class filter (matches Datto's real Maintenance Policy scope,
// narrower than Monitoring Policy above).
export type MaintenanceRecurrenceType = 'one_time' | 'weekly';

export interface MaintenancePolicy {
  id:                     string;
  name:                   string;
  description:            string | null;
  enabled:                boolean;
  recurrenceType:         MaintenanceRecurrenceType;
  oneTimeStartAt:         number | null;
  oneTimeDurationMinutes: number | null;
  weeklyDays:             string | null; // JSON int[], 0=Sun..6=Sat
  weeklyStartMinute:      number | null;
  weeklyDurationMinutes:  number | null;
  createdAt:              number;
  updatedAt:              number;
  companyIds?:   string[];
  deviceIds?: string[];
  groupIds?:  string[];
}

export interface MaintenanceRecurrenceBody {
  type: MaintenanceRecurrenceType;
  one_time_start_at?:         number;
  one_time_duration_minutes?: number;
  weekly_days?:               number[];
  weekly_start_minute?:       number;
  weekly_duration_minutes?:   number;
}

// Patch Policy — severity-threshold auto-approval plus a recurring
// scheduled install window, dispatched actively by the 2-minute cron
// (unlike Maintenance Policy's passive suppression-gate model). Same
// recurrence shape as MaintenancePolicy, duplicated not shared — see
// worker/src/lib/patchPolicies.ts.
export type PatchSeverity = 'Critical' | 'Important' | 'Moderate' | 'Low';

export interface PatchPolicy {
  id:                     string;
  name:                   string;
  description:            string | null;
  enabled:                boolean;
  recurrenceType:         MaintenanceRecurrenceType;
  oneTimeStartAt:         number | null;
  oneTimeDurationMinutes: number | null;
  weeklyDays:             string | null; // JSON int[], 0=Sun..6=Sat
  weeklyStartMinute:      number | null;
  weeklyDurationMinutes:  number | null;
  minSeverity:            PatchSeverity | null; // null = no auto-approval rule
  targetClass:            string; // JSON array — 'server'|'workstation'|'laptop', no OS dimension (Windows-only feature)
  autoReboot:             boolean;
  manageWindowsUpdate:    boolean;
  lastDispatchedAt:       number | null;
  createdAt:              number;
  updatedAt:              number;
  companyIds?:   string[];
  deviceIds?: string[];
  groupIds?:  string[];
}

// Host-wide singleton settings (currently just the Maintenance-Policy
// scheduling timezone) — see worker/src/db/schema.ts's hostSettings.
export interface HostSettings {
  id:        number;
  timezone:  string;
  updatedAt: number;
}

// Returned by GET /v1/admin/devices/:id/effective-monitors — a monitor that
// currently applies to this device, with its parent policy embedded (no
// `monitors` field on that embedded policy, unlike the full Policy type).
export interface EffectiveMonitor extends PolicyMonitor {
  policy: Omit<Policy, 'monitors'>;
}

export interface AlertState {
  id:                   string;
  is_alerting:          number; // SQLite boolean: 0 or 1
  condition_first_seen: number | null;
  alerted_at:           number | null;
  resolved_at:          number | null;
  updated_at:           number;
  device_id:            string;
  hostname:             string | null;
  os_type:              string | null;
  detected_class:       string | null;
  override_class:       string | null;
  company_id:            string;
  company_name:          string;
  monitor_id:           string;
  check_type:           CheckType;
  config:               string; // JSON
  priority:             AlertPriority;
  policy_id:            string;
  policy_name:          string;
  policy_scope:         string;
}

// ── Audit types ─────────────────────────────────────────────

export interface CPUInfo    { model: string; cores: number; speed_mhz: number }
export interface RAMInfo    { total_bytes: number; installed_bytes?: number }
export interface DiskInfo   { device: string; label: string; fs_type: string; total_bytes: number; free_bytes: number }
export interface NetworkInfo { name: string; hardware_addr: string; addrs: string[] }
export interface BIOSInfo   { vendor: string; version: string; release_date: string; serial_number?: string }
export interface SystemInfo { manufacturer?: string; model?: string; motherboard_vendor?: string; motherboard_model?: string }
export interface HardwareInfo {
  cpu: CPUInfo[]
  ram: RAMInfo
  disks: DiskInfo[]
  network: NetworkInfo[]
  bios?: BIOSInfo
  last_logged_in_user?: string
  architecture?: string
  system?: SystemInfo
  display_adapters?: string[]
  domain?: string
  windows_display_version?: string
  windows_installation_type?: string
  // Detected virtualization platform (e.g. "WSL2", "Hyper-V", "VMware") —
  // empty on bare metal or when undetectable.
  virtualization?: string
}
export interface SoftwareItem { name: string; version: string; publisher: string; installed_at: string }
export interface ServiceItem  { name: string; display_name: string; status: string; start_type: string }
export interface AVEntry      { name: string; enabled: boolean; up_to_date: boolean }
export interface SecurityInfo { antivirus: AVEntry[]; firewall_enabled: boolean }
// Pending/missing Windows Update patch (Windows-only, scan+report only —
// see agent/internal/audit/patches.go and worker/src/routes/audit.ts).
// update_id is WUA's own stable identity GUID -- the key for fleet-wide
// approval decisions (see FleetPatch below); empty on pre-upgrade agents.
export interface PatchItem {
  update_id?: string
  title: string
  kb_article_ids: string[]
  severity: string // Critical | Important | Moderate | Low | Unspecified
  categories: string[]
  size_bytes?: number
  is_downloaded: boolean
}

// A distinct Windows Update currently pending somewhere in the fleet, merged
// with its fleet-wide approval decision (see worker/src/routes/admin/patches.ts).
export interface FleetPatch {
  updateId: string
  title: string
  kbArticleIds: string[]
  severity: string
  categories: string[]
  deviceIds: string[]
  status: 'pending' | 'approved' | 'ignored'
}

export interface DeviceAudit {
  id: string
  deviceId: string
  companyId: string
  auditType: string
  agentVersion: string | null
  createdAt: number
  hardware: HardwareInfo | null
  software: SoftwareItem[] | null
  services: ServiceItem[] | null
  security: SecurityInfo | null
  patches: PatchItem[] | null
}

export interface AuditChange {
  id: string
  deviceId: string
  companyId: string
  auditId: string
  category: string
  changeType: string
  itemName: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  detectedAt: number
}

// ── Auth types ───────────────────────────────────────────────

export type Role = 'admin' | 'technician' | 'readonly';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  source?: 'break-glass' | 'session';
  authSource?: 'local' | 'microsoft';
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  authSource: 'local' | 'microsoft';
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  createdBy: string | null;
  receivesAlerts: boolean;
}

export interface WebhookEndpoint { id: string; url: string; enabled: boolean; createdAt: number; }
export interface NotificationEmail { id: string; email: string; enabled: boolean; createdAt: number; }
export type EmailProviderType = 'ses' | 'resend' | 'mailgun';
export interface EmailSettings {
  id: number;
  provider: EmailProviderType | null;
  fromAddress: string | null;
  enabled: boolean;
  hasConfig: boolean;
  updatedAt: number;
}

export interface SsoProvider {
  id: string;
  type: 'microsoft';
  name: string;
  directoryId: string;
  clientId: string;
  enabled: boolean;
  hasSecret: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SsoGroupRoleMapping {
  id: string;
  ssoProviderId: string;
  groupId: string;
  groupName: string | null;
  role: Role;
  createdAt: number;
}

export interface CustomField {
  id: string;
  name: string;
  key: string;
  sortOrder: number;
  createdAt: number;
}

export interface DeviceGroup {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  deviceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DeviceGroupMember {
  deviceId: string;
  hostname: string | null;
  companyName: string;
}

export interface BrandingIdentity { productName: string; logoKey: string | null; }
export interface BrandingRevision { id: string; revision: number; publishedAt: number; }
export interface BrandingTheme {
  id: string;
  name: string;
  source: 'built_in' | 'custom';
  draftTokens: ThemeTokens | null;
  revisions: BrandingRevision[];
  active: boolean;
}

export interface PolicyGroupTarget {
  groupId: string;
  name: string;
}

export interface DeviceCustomFieldValue {
  id: string;
  name: string;
  sortOrder: number;
  value: string | null;
}

export interface Device {
  id: string;
  companyId: string;
  companyName: string | null;
  status: DeviceStatus;
  hostname: string | null;
  osType: string | null;
  osVersion: string | null;
  detectedClass: string | null;
  overrideClass: string | null;
  agentVersion: string | null;
  lastSeen: number | null;
  inventory: string | null;
  createdAt: number;
  approvedAt: number | null;
  warrantyExpiresAt: number | null;
  externalIp: string | null;
  maintenanceEndsAt: number | null;
  maintenanceReason: string | null;
  windowsUpdateManaged: boolean | null;
  windowsUpdateManagedAt: number | null;
}

// ── API client ───────────────────────────────────────────────

export const api = {
  saveToken(t: string)  { sessionStorage.removeItem('beacon_emergency_token'); localStorage.setItem('beacon_token', t); },
  saveEmergencyToken(t: string) { localStorage.removeItem('beacon_token'); sessionStorage.setItem('beacon_emergency_token', t); },
  clearToken()          { localStorage.removeItem('beacon_token'); sessionStorage.removeItem('beacon_emergency_token'); },
  hasToken(): boolean   { return !!token(); },

  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: CurrentUser }>('POST', '/v1/auth/login', { email, password }, { skipAuthRedirect: true }),
    logout: () =>
      request<{ ok: boolean }>('POST', '/v1/auth/logout', undefined, { skipAuthRedirect: true }),
    me: () =>
      request<CurrentUser>('GET', '/v1/auth/me'),
    microsoftAvailable: () => request<{ available: boolean }>('GET', '/v1/auth/microsoft/available', undefined, { skipAuthRedirect: true }),
    microsoftLoginUrl: () => `${baseUrl}/v1/auth/microsoft/login`,
    microsoftExchange: (code: string) =>
      request<{ token: string; user: CurrentUser }>('POST', '/v1/auth/microsoft/exchange', { code }, { skipAuthRedirect: true }),
    verifyEmergencyAccess: async (secret: string) => {
      const res = await fetch(`${baseUrl}/v1/auth/me`, { headers: { Authorization: `Bearer ${secret}` } });
      if (!res.ok) throw new Error('unauthorized');
      return res.json() as Promise<CurrentUser>;
    },
  },

  users: {
    list:   () => request<AppUser[]>('GET', '/v1/admin/users'),
    create: (body: { email: string; displayName?: string; role: Role; password: string }) =>
      request<{ id: string }>('POST', '/v1/admin/users', body),
    update: (id: string, body: Partial<{ displayName: string; role: Role; status: 'active' | 'disabled'; receivesAlerts: boolean }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/users/${id}`, body),
    resetPassword: (id: string, password: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/users/${id}/reset-password`, { password }),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/users/${id}`),
  },

  webhooks: {
    list:   () => request<WebhookEndpoint[]>('GET', '/v1/admin/webhooks'),
    create: (url: string) => request<{ id: string }>('POST', '/v1/admin/webhooks', { url }),
    update: (id: string, body: Partial<{ enabled: boolean; url: string }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/webhooks/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/webhooks/${id}`),
  },

  notificationEmails: {
    list:   () => request<NotificationEmail[]>('GET', '/v1/admin/notification-emails'),
    create: (email: string) => request<{ id: string }>('POST', '/v1/admin/notification-emails', { email }),
    update: (id: string, body: Partial<{ enabled: boolean; email: string }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/notification-emails/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/notification-emails/${id}`),
  },

  emailSettings: {
    get: () => request<EmailSettings>('GET', '/v1/admin/email-settings'),
    update: (body: { provider?: EmailProviderType; fromAddress?: string; enabled?: boolean; config?: Record<string, string> }) =>
      request<{ ok: boolean }>('PATCH', '/v1/admin/email-settings', body),
  },

  customFields: {
    list:   () => request<CustomField[]>('GET', '/v1/admin/custom-fields'),
    create: (name: string, key?: string) => request<{ id: string }>('POST', '/v1/admin/custom-fields', { name, key }),
    update: (id: string, body: Partial<{ name: string; sort_order: number; key: string }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/custom-fields/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/custom-fields/${id}`),
  },

  branding: {
    list: () => request<BrandingTheme[]>('GET', '/v1/branding/admin/themes'),
    create: (name: string, tokens: ThemeTokens) => request<{ id: string }>('POST', '/v1/branding/admin/themes', { name, tokens }),
    update: (id: string, body: Partial<{ name: string; tokens: ThemeTokens }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/branding/admin/themes/${id}`, body),
    publish: (id: string) => request<BrandingRevision>('POST', `/v1/branding/admin/themes/${id}/publish`),
    activateBuiltIn: (id: string) => request<{ ok: boolean }>('POST', `/v1/branding/admin/themes/${id}/activate`),
    activate: (revisionId: string) => request<{ ok: boolean }>('POST', `/v1/branding/admin/revisions/${revisionId}/activate`),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/branding/admin/themes/${id}`),
    identity: {
      get: () => request<BrandingIdentity>('GET', '/v1/branding/identity'),
      update: (productName: string) => request<{ ok: boolean }>('PATCH', '/v1/branding/admin/identity', { productName }),
    },
    logo: {
      upload: (file: File) => uploadFile<{ logoKey: string }>('/v1/branding/admin/logo', file),
      remove: () => request<{ ok: boolean }>('DELETE', '/v1/branding/admin/logo'),
    },
  },

  groups: {
    list:   () => request<DeviceGroup[]>('GET', '/v1/admin/groups'),
    get:    (id: string) => request<DeviceGroup>('GET', `/v1/admin/groups/${id}`),
    create: (body: { name: string; description?: string }) => request<{ id: string }>('POST', '/v1/admin/groups', body),
    update: (id: string, body: Partial<{ name: string; description: string }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/groups/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/groups/${id}`),
    members: {
      list:    (groupId: string) => request<DeviceGroupMember[]>('GET', `/v1/admin/groups/${groupId}/members`),
      add:     (groupId: string, deviceId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/groups/${groupId}/members`, { device_id: deviceId }),
      addBulk: (groupId: string, deviceIds: string[]) =>
        request<{ ok: boolean; added: number }>('POST', `/v1/admin/groups/${groupId}/members/bulk`, { device_ids: deviceIds }),
      remove:  (groupId: string, deviceId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/groups/${groupId}/members/${deviceId}`),
    },
  },

  sso: {
    providers: {
      list:   () => request<SsoProvider[]>('GET', '/v1/admin/sso/providers'),
      create: (body: { name: string; directoryId: string; clientId: string; clientSecret: string }) =>
        request<{ id: string }>('POST', '/v1/admin/sso/providers', body),
      update: (id: string, body: Partial<{ name: string; directoryId: string; clientId: string; clientSecret: string; enabled: boolean }>) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/sso/providers/${id}`, body),
      delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/sso/providers/${id}`),
      searchGroups: (id: string, search: string) =>
        request<{ id: string; displayName?: string }[]>('GET', `/v1/admin/sso/providers/${id}/groups?search=${encodeURIComponent(search)}`),
    },
    groupMappings: {
      list:   (providerId: string) => request<SsoGroupRoleMapping[]>('GET', `/v1/admin/sso/providers/${providerId}/group-mappings`),
      create: (providerId: string, body: { groupId: string; groupName?: string; role: Role }) =>
        request<{ id: string }>('POST', `/v1/admin/sso/providers/${providerId}/group-mappings`, body),
      delete: (providerId: string, mappingId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/sso/providers/${providerId}/group-mappings/${mappingId}`),
    },
  },

  summary: {
    get: () => request<Summary>('GET', '/v1/admin/summary'),
  },

  dashboards: {
    list: () => request<Dashboard[]>('GET', '/v1/admin/dashboards'),
    get: (id: string) => request<DashboardDetail>('GET', `/v1/admin/dashboards/${id}`),
    data: (id: string, companyId?: string) => request<DashboardData>('GET', `/v1/admin/dashboards/${id}/data${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''}`),
    create: (body: { name: string; template: 'default' | 'blank' }) => request<DashboardDetail>('POST', '/v1/admin/dashboards', body),
    update: (id: string, body: Partial<{ name: string; sortOrder: number; isHome: boolean; companyIds: string[] }>) => request<DashboardDetail>('PATCH', `/v1/admin/dashboards/${id}`, body),
    clone: (id: string, body?: { name?: string }) => request<DashboardDetail>('POST', `/v1/admin/dashboards/${id}/clone`, body ?? {}),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/dashboards/${id}`),
    widgets: {
      create: (dashboardId: string, body: { type: DashboardWidgetType; title?: string; layout?: { x: number; y: number; w: number; h: number } }) => request<DashboardWidget>('POST', `/v1/admin/dashboards/${dashboardId}/widgets`, body),
      update: (dashboardId: string, widgetId: string, body: { title?: string | null; layout?: { x: number; y: number; w: number; h: number } }) => request<{ ok: boolean }>('PATCH', `/v1/admin/dashboards/${dashboardId}/widgets/${widgetId}`, body),
      delete: (dashboardId: string, widgetId: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/dashboards/${dashboardId}/widgets/${widgetId}`),
    },
  },

  components: {
    list:   (companyId?: string)  => request<Component[]>('GET', `/v1/admin/components${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''}`),
    get:    (id: string)          => request<Component>('GET', `/v1/admin/components/${id}`),
    create: (body: {
      name: string;
      description?: string | null;
      category?: string | null;
      type?: 'script' | 'application';
      scope?: 'global' | 'company';
      shell?: string;
      script: string;
      timeout_seconds?: number;
      post_conditions?: PostCondition[];
      target_os?: string | null;
    })                            => request<Component>('POST', '/v1/admin/components', body),
    update: (id: string, body: Partial<{
      name: string;
      description: string | null;
      category: string | null;
      type: 'script' | 'application';
      scope: 'global' | 'company';
      shell: string;
      script: string;
      timeout_seconds: number;
      post_conditions: PostCondition[];
      target_os: string | null;
    }>)                           => request<{ ok: boolean }>('PATCH', `/v1/admin/components/${id}`, body),
    delete: (id: string)          => request<{ ok: boolean }>('DELETE', `/v1/admin/components/${id}`),
    clone:  (id: string, name?: string) => request<Component>('POST', `/v1/admin/components/${id}/clone`, { name }),
    store: {
      list: () => request<Component[]>('GET', '/v1/admin/components/store'),
    },
    companies: {
      list:   (componentId: string) => request<ComponentCompany[]>('GET', `/v1/admin/components/${componentId}/companies`),
      add:    (componentId: string, companyId: string) => request<{ ok: boolean }>('POST', `/v1/admin/components/${componentId}/companies`, { company_id: companyId }),
      remove: (componentId: string, companyId: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/components/${componentId}/companies/${companyId}`),
    },
    variables: {
      list:   (componentId: string) => request<ComponentVariable[]>('GET', `/v1/admin/components/${componentId}/variables`),
      create: (componentId: string, body: {
        name: string;
        label: string;
        type?: ComponentVariableType;
        options?: ComponentVariableOption[];
        default_value?: string | null;
        description?: string | null;
        required?: boolean;
        sort_order?: number;
      }) => request<ComponentVariable>('POST', `/v1/admin/components/${componentId}/variables`, body),
      update: (componentId: string, variableId: string, body: Partial<{
        name: string;
        label: string;
        type: ComponentVariableType;
        options: ComponentVariableOption[];
        default_value: string | null;
        description: string | null;
        required: boolean;
        sort_order: number;
      }>) => request<{ ok: boolean }>('PATCH', `/v1/admin/components/${componentId}/variables/${variableId}`, body),
      delete: (componentId: string, variableId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/components/${componentId}/variables/${variableId}`),
    },
  },

  jobs: {
    list:   (params?: { type?: string; status?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Job[]>('GET', `/v1/admin/jobs${qs ? `?${qs}` : ''}`);
    },
    get:    (id: string)          => request<JobDetail>('GET', `/v1/admin/jobs/${id}`),
    create: (body: {
      name: string;
      description?: string;
      type?: 'quick' | 'scheduled';
      components: ComponentRef[];
      target_type?: string;
      target_ids?: string[];
      scheduled_at?: number;
      expires_at?: number;
      run_as_system?: boolean;
    })                            => request<Job>('POST', '/v1/admin/jobs', body),
    cancel: (id: string)          => request<{ ok: boolean }>('DELETE', `/v1/admin/jobs/${id}`),
    purge:  (id: string)          => request<{ ok: boolean }>('DELETE', `/v1/admin/jobs/${id}/purge`),
  },

  companies: {
    list:   () => request<Company[]>('GET', '/v1/admin/companies'),
    create: (body: {
      name: string;
      auto_approve_default?: boolean;
      privacy_mode_default?: boolean;
      website?: string | null;
      notes?: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
    }) => request<Company>('POST', '/v1/admin/companies', body),
    update: (id: string, body: {
      name?: string;
      auto_approve_default?: boolean;
      privacy_mode_default?: boolean;
      status?: 'active' | 'suspended';
      website?: string | null;
      notes?: string | null;
    }) => request<{ ok: boolean }>('PATCH', `/v1/admin/companies/${id}`, body),

    contacts: {
      list: (companyId: string) =>
        request<CompanyContact[]>('GET', `/v1/admin/companies/${companyId}/contacts`),
      create: (companyId: string, body: { name: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean }) =>
        request<CompanyContact>('POST', `/v1/admin/companies/${companyId}/contacts`, body),
      update: (companyId: string, contactId: string, body: { name?: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean }) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/companies/${companyId}/contacts/${contactId}`, body),
      delete: (companyId: string, contactId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/companies/${companyId}/contacts/${contactId}`),
    },

    locations: {
      list: (companyId: string) =>
        request<CompanyLocation[]>('GET', `/v1/admin/companies/${companyId}/locations`),
      create: (companyId: string, body: { name: string; is_primary?: boolean; street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }) =>
        request<CompanyLocation>('POST', `/v1/admin/companies/${companyId}/locations`, body),
      update: (companyId: string, locationId: string, body: { name?: string; is_primary?: boolean; street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/companies/${companyId}/locations/${locationId}`, body),
      delete: (companyId: string, locationId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/companies/${companyId}/locations/${locationId}`),
    },

    variables: {
      list: (companyId: string) =>
        request<CompanyVariable[]>('GET', `/v1/admin/companies/${companyId}/variables`),
      create: (companyId: string, body: { key: string; is_secret?: boolean; value?: string | null; description?: string | null }) =>
        request<CompanyVariable>('POST', `/v1/admin/companies/${companyId}/variables`, body),
      update: (companyId: string, varId: string, body: { value?: string | null; description?: string | null }) =>
        request<CompanyVariable>('PATCH', `/v1/admin/companies/${companyId}/variables/${varId}`, body),
      delete: (companyId: string, varId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/companies/${companyId}/variables/${varId}`),
    },

    discovery: {
      get: (companyId: string) =>
        request<NetworkDiscoveryConfig | null>('GET', `/v1/admin/companies/${companyId}/discovery`),
      save: (companyId: string, body: { probe_device_id: string; cidr_ranges: string[]; scan_interval_minutes?: number; enabled?: boolean }) =>
        request<NetworkDiscoveryConfig>('POST', `/v1/admin/companies/${companyId}/discovery`, body),
      scanNow: (companyId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/companies/${companyId}/discovery/scan-now`),
    },

    discoveredDevices: {
      list: (companyId: string) =>
        request<DiscoveredDevice[]>('GET', `/v1/admin/companies/${companyId}/discovered-devices`),
      update: (companyId: string, deviceId: string, body: { dismissed: boolean }) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/companies/${companyId}/discovered-devices/${deviceId}`, body),
      delete: (companyId: string, deviceId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/companies/${companyId}/discovered-devices/${deviceId}`),
    },

    tokens: {
      list: (companyId: string) =>
        request<EnrollmentToken[]>('GET', `/v1/admin/companies/${companyId}/tokens`),
      create: (companyId: string, body: { auto_approve?: boolean | null; max_uses?: number | null; expires_in_days?: number | null }) =>
        request<{ id: string; raw_token: string; expires_at: number | null; max_uses: number | null }>(
          'POST', `/v1/admin/companies/${companyId}/tokens`, body),
      revoke: (companyId: string, tokenId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/companies/${companyId}/tokens/${tokenId}`),
      delete: (companyId: string, tokenId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/companies/${companyId}/tokens/${tokenId}/permanent`),
    },
  },

  policies: {
    list: (params?: { scope?: 'global' | 'company' }) => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
      return request<Policy[]>('GET', `/v1/admin/policies${qs ? `?${qs}` : ''}`);
    },
    create: (body: {
      name:          string;
      description?:  string | null;
      target_os?:    string[];
      target_class?: string[];
      clone_from?:   string;
    }) => request<Policy>('POST', '/v1/admin/policies', body),
    update: (id: string, body: {
      name?:         string;
      description?:  string | null;
      enabled?:      boolean;
      target_os?:    string[];
      target_class?: string[];
    }) => request<{ ok: boolean }>('PATCH', `/v1/admin/policies/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/policies/${id}`),
    monitors: {
      list: (policyId: string) =>
        request<PolicyMonitor[]>('GET', `/v1/admin/policies/${policyId}/monitors`),
      create: (policyId: string, body: {
        check_type:                CheckType;
        config:                    Record<string, unknown>;
        alert_priority?:           AlertPriority;
        sustained_minutes?:        number;
        check_interval_minutes?:  number;
        auto_resolve?:             boolean;
        auto_resolve_after_minutes?: number;
        notify_webhook?:           boolean;
        notify_email?:             boolean;
      }) => request<{ monitor_id: string }>('POST', `/v1/admin/policies/${policyId}/monitors`, body),
      update: (policyId: string, mid: string, body: {
        enabled?:                boolean;
        config?:                 Record<string, unknown>;
        alert_priority?:         AlertPriority;
        sustained_minutes?:      number;
        check_interval_minutes?: number;
        auto_resolve?:           boolean;
        auto_resolve_after_minutes?: number;
        notify_webhook?:         boolean;
        notify_email?:           boolean;
      }) => request<{ ok: boolean }>('PATCH', `/v1/admin/policies/${policyId}/monitors/${mid}`, body),
      delete: (policyId: string, mid: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/policies/${policyId}/monitors/${mid}`),
    },
    groups: {
      list: (policyId: string) => request<PolicyGroupTarget[]>('GET', `/v1/admin/policies/${policyId}/groups`),
      add:  (policyId: string, groupId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/policies/${policyId}/groups`, { group_id: groupId }),
      remove: (policyId: string, groupId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/policies/${policyId}/groups/${groupId}`),
    },
    companies: {
      list: (policyId: string) => request<PolicyCompanyTarget[]>('GET', `/v1/admin/policies/${policyId}/companies`),
      add:  (policyId: string, companyId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/policies/${policyId}/companies`, { company_id: companyId }),
      remove: (policyId: string, companyId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/policies/${policyId}/companies/${companyId}`),
    },
    devices: {
      list: (policyId: string) => request<PolicyDeviceTarget[]>('GET', `/v1/admin/policies/${policyId}/devices`),
      add:  (policyId: string, deviceId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/policies/${policyId}/devices`, { device_id: deviceId }),
      remove: (policyId: string, deviceId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/policies/${policyId}/devices/${deviceId}`),
    },
  },

  maintenancePolicies: {
    list: () => request<MaintenancePolicy[]>('GET', '/v1/admin/maintenance-policies'),
    create: (body: {
      name:         string;
      description?: string | null;
      enabled?:     boolean;
      recurrence?:  MaintenanceRecurrenceBody;
      clone_from?:  string;
    }) => request<MaintenancePolicy>('POST', '/v1/admin/maintenance-policies', body),
    update: (id: string, body: {
      name?:        string;
      description?: string | null;
      enabled?:     boolean;
      recurrence?:  MaintenanceRecurrenceBody;
    }) => request<{ ok: boolean }>('PATCH', `/v1/admin/maintenance-policies/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/maintenance-policies/${id}`),
    companies: {
      list: (policyId: string) => request<PolicyCompanyTarget[]>('GET', `/v1/admin/maintenance-policies/${policyId}/companies`),
      add:  (policyId: string, companyId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/maintenance-policies/${policyId}/companies`, { company_id: companyId }),
      remove: (policyId: string, companyId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/maintenance-policies/${policyId}/companies/${companyId}`),
    },
    devices: {
      list: (policyId: string) => request<PolicyDeviceTarget[]>('GET', `/v1/admin/maintenance-policies/${policyId}/devices`),
      add:  (policyId: string, deviceId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/maintenance-policies/${policyId}/devices`, { device_id: deviceId }),
      remove: (policyId: string, deviceId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/maintenance-policies/${policyId}/devices/${deviceId}`),
    },
    groups: {
      list: (policyId: string) => request<PolicyGroupTarget[]>('GET', `/v1/admin/maintenance-policies/${policyId}/groups`),
      add:  (policyId: string, groupId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/maintenance-policies/${policyId}/groups`, { group_id: groupId }),
      remove: (policyId: string, groupId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/maintenance-policies/${policyId}/groups/${groupId}`),
    },
  },

  patchPolicies: {
    list: () => request<PatchPolicy[]>('GET', '/v1/admin/patch-policies'),
    create: (body: {
      name:          string;
      description?:  string | null;
      enabled?:      boolean;
      recurrence?:   MaintenanceRecurrenceBody;
      min_severity?: PatchSeverity | null;
      target_class?: string[];
      auto_reboot?:  boolean;
      manage_windows_update?: boolean;
      clone_from?:   string;
    }) => request<PatchPolicy>('POST', '/v1/admin/patch-policies', body),
    update: (id: string, body: {
      name?:         string;
      description?:  string | null;
      enabled?:      boolean;
      recurrence?:   MaintenanceRecurrenceBody;
      min_severity?: PatchSeverity | null;
      target_class?: string[];
      auto_reboot?:  boolean;
      manage_windows_update?: boolean;
    }) => request<{ ok: boolean }>('PATCH', `/v1/admin/patch-policies/${id}`, body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/patch-policies/${id}`),
    companies: {
      list: (policyId: string) => request<PolicyCompanyTarget[]>('GET', `/v1/admin/patch-policies/${policyId}/companies`),
      add:  (policyId: string, companyId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/patch-policies/${policyId}/companies`, { company_id: companyId }),
      remove: (policyId: string, companyId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/patch-policies/${policyId}/companies/${companyId}`),
    },
    devices: {
      list: (policyId: string) => request<PolicyDeviceTarget[]>('GET', `/v1/admin/patch-policies/${policyId}/devices`),
      add:  (policyId: string, deviceId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/patch-policies/${policyId}/devices`, { device_id: deviceId }),
      remove: (policyId: string, deviceId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/patch-policies/${policyId}/devices/${deviceId}`),
    },
    groups: {
      list: (policyId: string) => request<PolicyGroupTarget[]>('GET', `/v1/admin/patch-policies/${policyId}/groups`),
      add:  (policyId: string, groupId: string) =>
        request<{ ok: boolean }>('POST', `/v1/admin/patch-policies/${policyId}/groups`, { group_id: groupId }),
      remove: (policyId: string, groupId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/patch-policies/${policyId}/groups/${groupId}`),
    },
  },

  settings: {
    get: () => request<HostSettings>('GET', '/v1/admin/settings'),
    update: (body: { timezone?: string }) => request<{ ok: boolean }>('PATCH', '/v1/admin/settings', body),
  },

  alerts: {
    list: (status: 'active' | 'all' = 'active', search = '', companyId = '', deviceId = '') =>
      request<AlertState[]>('GET', `/v1/admin/alerts?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}${companyId ? `&company_id=${encodeURIComponent(companyId)}` : ''}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`),
    get: (id: string) =>
      request<AlertState>('GET', `/v1/admin/alerts/${id}`),
    resolve: (id: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/alerts/${id}/resolve`),
  },

  activityLog: {
    list: (filters: ActivityLogFilters = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '') params.set(k, String(v));
      }
      const qs = params.toString();
      return request<{ rows: ActivityLogEntry[]; total: number }>('GET', `/v1/admin/activity-log${qs ? `?${qs}` : ''}`);
    },
  },

  patches: {
    list: () => request<{ patches: FleetPatch[]; needsRescan: number }>('GET', '/v1/admin/patches'),
    setStatus: (updateId: string, body: { status: 'approved' | 'ignored' | 'pending'; title?: string; kb_article_ids?: string[]; severity?: string }) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/patches/${encodeURIComponent(updateId)}`, body),
  },

  devices: {
    list:    (status?: DeviceStatus) => request<Device[]>('GET', `/v1/admin/devices${status ? `?status=${status}` : ''}`),
    get:     (id: string)            => request<Device>('GET', `/v1/admin/devices/${id}`),
    update:  (id: string, body: { warranty_expires_at: number | null }) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/devices/${id}`, body),
    approve: (id: string)            => request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/approve`),
    revoke:  (id: string)            => request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/revoke`),
    delete:  (id: string)            => request<{ ok: boolean }>('DELETE', `/v1/admin/devices/${id}`),
    effectiveMonitors: (id: string)  => request<EffectiveMonitor[]>('GET', `/v1/admin/devices/${id}/effective-monitors`),
    commands: {
      list:   (deviceId: string) =>
        request<DeviceCommand[]>('GET', `/v1/admin/devices/${deviceId}/commands`),
      create: (deviceId: string, body: { type: 'run_script' | 'reboot' | 'run_audit' | 'restart_agent' | 'force_update' | 'install_patches' | 'uninstall_agent'; shell?: string; script?: string; timeout_seconds?: number; update_ids?: string[] }) =>
        request<{ id: string }>('POST', `/v1/admin/devices/${deviceId}/commands`, body),
    },
    maintenance: {
      set: (deviceId: string, body: { ends_at: number; reason?: string }) =>
        request<{ ok: boolean }>('POST', `/v1/admin/devices/${deviceId}/maintenance`, body),
      end: (deviceId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/devices/${deviceId}/maintenance`),
    },
    audit: {
      latest:  (deviceId: string) =>
        request<DeviceAudit | null>('GET', `/v1/admin/devices/${deviceId}/audit/latest`),
      changes: (deviceId: string, limit = 100) =>
        request<AuditChange[]>('GET', `/v1/admin/devices/${deviceId}/audit/changes?limit=${limit}`),
    },
    customFields: {
      list: (deviceId: string) =>
        request<DeviceCustomFieldValue[]>('GET', `/v1/admin/devices/${deviceId}/custom-fields`),
      set: (deviceId: string, fieldId: string, value: string | null) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/devices/${deviceId}/custom-fields/${fieldId}`, { value }),
    },
  },
  sessions: {
    open: (deviceId: string, companyId: string, sessionType: 'shell' | 'tcp_tunnel') =>
      request<{ session_id: string; client_ws_url: string }>('POST', '/v1/sessions', {
        device_id: deviceId, company_id: companyId, session_type: sessionType,
      }),
  },
};
