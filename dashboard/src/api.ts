const baseUrl = import.meta.env.VITE_API_URL ?? '';

function secret(): string {
  return localStorage.getItem('beacon_secret') ?? '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secret()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) throw new Error('unauthorized');
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

export interface Component {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: 'script' | 'application';
  shell: string;
  script: string;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export type ComponentRef =
  | { type: 'library'; component_id: string; order: number }
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

export type CheckType = 'disk_space' | 'offline' | 'cpu_usage' | 'memory_usage';

export interface AlertDefinition {
  id: string;
  tenantId: string;
  tenantName?: string; // present in global listing
  deviceId: string | null;
  deviceClass: 'server' | 'workstation' | 'laptop' | null;
  checkType: CheckType;
  threshold: string; // JSON
  consecutiveFailuresRequired: number;
  enabled: boolean;
  createdAt: number;
}

export interface AlertState {
  id: string;
  is_alerting: number; // SQLite boolean: 0 or 1
  consecutive_failures: number;
  alerted_at: number | null;
  resolved_at: number | null;
  updated_at: number;
  device_id: string;
  hostname: string | null;
  os_type: string | null;
  detected_class: string | null;
  override_class: string | null;
  tenant_id: string;
  tenant_name: string;
  definition_id: string;
  check_type: CheckType;
  threshold: string; // JSON
  consecutive_failures_required: number;
  definition_device_class: string | null;
}

// ── Audit types ─────────────────────────────────────────────

export interface CPUInfo    { model: string; cores: number; speed_mhz: number }
export interface RAMInfo    { total_bytes: number }
export interface DiskInfo   { device: string; label: string; fs_type: string; total_bytes: number; free_bytes: number }
export interface NetworkInfo { name: string; hardware_addr: string; addrs: string[] }
export interface BIOSInfo   { vendor: string; version: string; release_date: string }
export interface HardwareInfo {
  cpu: CPUInfo[]
  ram: RAMInfo
  disks: DiskInfo[]
  network: NetworkInfo[]
  bios?: BIOSInfo
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
}

// ── API client ───────────────────────────────────────────────

export const api = {
  saveSecret(s: string)  { localStorage.setItem('beacon_secret', s); },
  clearSecret()          { localStorage.removeItem('beacon_secret'); },
  hasSecret(): boolean   { return !!secret(); },

  summary: {
    get: () => request<Summary>('GET', '/v1/admin/summary'),
  },

  components: {
    list:   ()                    => request<Component[]>('GET', '/v1/admin/components'),
    get:    (id: string)          => request<Component>('GET', `/v1/admin/components/${id}`),
    create: (body: {
      name: string;
      description?: string | null;
      category?: string | null;
      type?: 'script' | 'application';
      shell?: string;
      script: string;
      timeout_seconds?: number;
    })                            => request<Component>('POST', '/v1/admin/components', body),
    update: (id: string, body: Partial<{
      name: string;
      description: string | null;
      category: string | null;
      type: 'script' | 'application';
      shell: string;
      script: string;
      timeout_seconds: number;
    }>)                           => request<{ ok: boolean }>('PATCH', `/v1/admin/components/${id}`, body),
    delete: (id: string)          => request<{ ok: boolean }>('DELETE', `/v1/admin/components/${id}`),
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
    })                            => request<Job>('POST', '/v1/admin/jobs', body),
    cancel: (id: string)          => request<{ ok: boolean }>('DELETE', `/v1/admin/jobs/${id}`),
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

  monitors: {
    list:   (tenantId?: string) => {
      const qs = tenantId ? `?tenant_id=${tenantId}` : '';
      return request<AlertDefinition[]>('GET', `/v1/admin/alert-definitions${qs}`);
    },
    create: (body: {
      tenant_id: string;
      device_id?: string;
      device_class?: 'server' | 'workstation' | 'laptop';
      check_type: CheckType;
      threshold: Record<string, number>;
      consecutive_failures_required?: number;
    }) => request<{ definition_id: string }>('POST', '/v1/admin/alert-definitions', body),
    delete: (id: string) => request<{ ok: boolean }>('DELETE', `/v1/admin/alert-definitions/${id}`),
  },

  alerts: {
    list: (status: 'active' | 'all' = 'active') =>
      request<AlertState[]>('GET', `/v1/admin/alerts?status=${status}`),
  },

  devices: {
    list:    (status?: DeviceStatus) => request<Device[]>('GET', `/v1/admin/devices${status ? `?status=${status}` : ''}`),
    get:     (id: string)            => request<Device>('GET', `/v1/admin/devices/${id}`),
    approve: (id: string)            => request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/approve`),
    revoke:  (id: string)            => request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/revoke`),
    delete:  (id: string)            => request<{ ok: boolean }>('DELETE', `/v1/admin/devices/${id}`),
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
};
