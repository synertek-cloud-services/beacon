const baseUrl = import.meta.env.VITE_API_URL ?? '';

function token(): string {
  return localStorage.getItem('beacon_token') ?? '';
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
      window.location.hash = '#/login';
    }
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
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
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface Tenant {
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

export interface TenantContact {
  id: string;
  tenantId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: number;
}

export interface TenantLocation {
  id: string;
  tenantId: string;
  name: string;
  isPrimary: boolean;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  createdAt: number;
}

export interface EnrollmentToken {
  id: string;
  tenantId: string;
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

export interface ComponentSite {
  tenantId: string;
  name: string;
}

export interface Component {
  id: string;
  name: string;
  description: string | null;
  category: string | null; // freeform organizational tag — shown in the UI as "Group"
  type: 'script' | 'application';
  origin: 'custom' | 'store';
  scope: 'global' | 'company'; // "Sites" scoping — 'company' means restricted to `sites` below (a real multi-site list, not a single company)
  sites: ComponentSite[];
  shell: string;
  script: string;
  timeoutSeconds: number;
  postConditions: PostCondition[];
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
  status: 'queued' | 'sent' | 'completed' | 'failed';
  result: string | null;
  warning: boolean;
  createdAt: number;
  completedAt: number | null;
}

export interface JobDevice {
  deviceId: string;
  hostname: string | null;
  osType: string | null;
  tenantName: string;
  commands: JobDeviceCommand[];
}

export interface JobDetail extends Job {
  devices: JobDevice[];
}

export interface DeviceCommand {
  id: string;
  deviceId: string;
  tenantId: string;
  type: string;
  payload: string; // JSON
  status: 'queued' | 'sent' | 'completed' | 'failed';
  result: string | null; // JSON: { stdout, stderr, exit_code }
  createdAt: number;
  completedAt: number | null;
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
  createdAt:               number;
}

export interface Policy {
  id:          string;
  name:        string;
  description: string | null;
  scope:       'global' | 'company';
  companyId:   string | null;
  enabled:     boolean;
  targetOs:    string; // JSON array
  targetClass: string; // JSON array
  createdAt:   number;
  updatedAt:   number;
  monitors:    PolicyMonitor[];
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
  tenant_id:            string;
  tenant_name:          string;
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

export interface DeviceAudit {
  id: string
  deviceId: string
  tenantId: string
  auditType: string
  agentVersion: string | null
  createdAt: number
  hardware: HardwareInfo | null
  software: SoftwareItem[] | null
  services: ServiceItem[] | null
  security: SecurityInfo | null
}

export interface AuditChange {
  id: string
  deviceId: string
  tenantId: string
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

export interface Device {
  id: string;
  tenantId: string;
  tenantName: string | null;
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
}

// ── API client ───────────────────────────────────────────────

export const api = {
  saveToken(t: string)  { localStorage.setItem('beacon_token', t); },
  clearToken()          { localStorage.removeItem('beacon_token'); },
  hasToken(): boolean   { return !!token(); },

  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: CurrentUser }>('POST', '/v1/auth/login', { email, password }, { skipAuthRedirect: true }),
    logout: () =>
      request<{ ok: boolean }>('POST', '/v1/auth/logout', undefined, { skipAuthRedirect: true }),
    me: () =>
      request<CurrentUser>('GET', '/v1/auth/me'),
    microsoftLoginUrl: () => `${baseUrl}/v1/auth/microsoft/login`,
    microsoftExchange: (code: string) =>
      request<{ token: string; user: CurrentUser }>('POST', '/v1/auth/microsoft/exchange', { code }, { skipAuthRedirect: true }),
  },

  users: {
    list:   () => request<AppUser[]>('GET', '/v1/admin/users'),
    create: (body: { email: string; displayName?: string; role: Role; password: string }) =>
      request<{ id: string }>('POST', '/v1/admin/users', body),
    update: (id: string, body: Partial<{ displayName: string; role: Role; status: 'active' | 'disabled' }>) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/users/${id}`, body),
    resetPassword: (id: string, password: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/users/${id}/reset-password`, { password }),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/users/${id}`),
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
    }>)                           => request<{ ok: boolean }>('PATCH', `/v1/admin/components/${id}`, body),
    delete: (id: string)          => request<{ ok: boolean }>('DELETE', `/v1/admin/components/${id}`),
    clone:  (id: string, name?: string) => request<Component>('POST', `/v1/admin/components/${id}/clone`, { name }),
    store: {
      list: () => request<Component[]>('GET', '/v1/admin/components/store'),
    },
    sites: {
      list:   (componentId: string) => request<ComponentSite[]>('GET', `/v1/admin/components/${componentId}/sites`),
      add:    (componentId: string, tenantId: string) => request<{ ok: boolean }>('POST', `/v1/admin/components/${componentId}/sites`, { tenant_id: tenantId }),
      remove: (componentId: string, tenantId: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/components/${componentId}/sites/${tenantId}`),
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

  tenants: {
    list:   () => request<Tenant[]>('GET', '/v1/admin/tenants'),
    create: (body: {
      name: string;
      auto_approve_default?: boolean;
      privacy_mode_default?: boolean;
      website?: string | null;
      notes?: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
    }) => request<Tenant>('POST', '/v1/admin/tenants', body),
    update: (id: string, body: {
      name?: string;
      auto_approve_default?: boolean;
      privacy_mode_default?: boolean;
      status?: 'active' | 'suspended';
      website?: string | null;
      notes?: string | null;
    }) => request<{ ok: boolean }>('PATCH', `/v1/admin/tenants/${id}`, body),

    contacts: {
      list: (tenantId: string) =>
        request<TenantContact[]>('GET', `/v1/admin/tenants/${tenantId}/contacts`),
      create: (tenantId: string, body: { name: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean }) =>
        request<TenantContact>('POST', `/v1/admin/tenants/${tenantId}/contacts`, body),
      update: (tenantId: string, contactId: string, body: { name?: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean }) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/tenants/${tenantId}/contacts/${contactId}`, body),
      delete: (tenantId: string, contactId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/tenants/${tenantId}/contacts/${contactId}`),
    },

    locations: {
      list: (tenantId: string) =>
        request<TenantLocation[]>('GET', `/v1/admin/tenants/${tenantId}/locations`),
      create: (tenantId: string, body: { name: string; is_primary?: boolean; street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }) =>
        request<TenantLocation>('POST', `/v1/admin/tenants/${tenantId}/locations`, body),
      update: (tenantId: string, locationId: string, body: { name?: string; is_primary?: boolean; street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }) =>
        request<{ ok: boolean }>('PATCH', `/v1/admin/tenants/${tenantId}/locations/${locationId}`, body),
      delete: (tenantId: string, locationId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/tenants/${tenantId}/locations/${locationId}`),
    },

    tokens: {
      list: (tenantId: string) =>
        request<EnrollmentToken[]>('GET', `/v1/admin/tenants/${tenantId}/tokens`),
      create: (tenantId: string, body: { auto_approve?: boolean | null; max_uses?: number | null; expires_in_days?: number | null }) =>
        request<{ id: string; raw_token: string; expires_at: number | null; max_uses: number | null }>(
          'POST', `/v1/admin/tenants/${tenantId}/tokens`, body),
      revoke: (tenantId: string, tokenId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/tenants/${tenantId}/tokens/${tokenId}`),
      delete: (tenantId: string, tokenId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/tenants/${tenantId}/tokens/${tokenId}/permanent`),
    },
  },

  policies: {
    list: (params?: { scope?: 'global' | 'company'; company_id?: string }) => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
      return request<Policy[]>('GET', `/v1/admin/policies${qs ? `?${qs}` : ''}`);
    },
    create: (body: {
      name:          string;
      description?:  string | null;
      scope?:        'global' | 'company';
      company_id?:   string | null;
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
      }) => request<{ monitor_id: string }>('POST', `/v1/admin/policies/${policyId}/monitors`, body),
      update: (policyId: string, mid: string, body: {
        enabled?:                boolean;
        config?:                 Record<string, unknown>;
        alert_priority?:         AlertPriority;
        sustained_minutes?:      number;
        check_interval_minutes?: number;
        auto_resolve?:           boolean;
        auto_resolve_after_minutes?: number;
      }) => request<{ ok: boolean }>('PATCH', `/v1/admin/policies/${policyId}/monitors/${mid}`, body),
      delete: (policyId: string, mid: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/policies/${policyId}/monitors/${mid}`),
    },
  },

  alerts: {
    list: (status: 'active' | 'all' = 'active', search = '', companyId = '', deviceId = '') =>
      request<AlertState[]>('GET', `/v1/admin/alerts?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}${companyId ? `&company_id=${encodeURIComponent(companyId)}` : ''}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`),
    resolve: (id: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/alerts/${id}/resolve`),
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
      create: (deviceId: string, body: { type: 'run_script' | 'reboot' | 'run_audit'; shell?: string; script?: string; timeout_seconds?: number }) =>
        request<{ id: string }>('POST', `/v1/admin/devices/${deviceId}/commands`, body),
    },
    audit: {
      latest:  (deviceId: string) =>
        request<DeviceAudit | null>('GET', `/v1/admin/devices/${deviceId}/audit/latest`),
      changes: (deviceId: string, limit = 100) =>
        request<AuditChange[]>('GET', `/v1/admin/devices/${deviceId}/audit/changes?limit=${limit}`),
    },
  },
  sessions: {
    open: (deviceId: string, tenantId: string, sessionType: 'shell' | 'tcp_tunnel') =>
      request<{ session_id: string; client_ws_url: string }>('POST', '/v1/sessions', {
        device_id: deviceId, tenant_id: tenantId, session_type: sessionType,
      }),
  },
};
