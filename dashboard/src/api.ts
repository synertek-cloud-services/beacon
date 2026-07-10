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

export interface Device {
  id: string;
  tenantId: string;
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
    },
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
      create: (deviceId: string, body: { type: 'run_script' | 'reboot'; shell?: string; script?: string; timeout_seconds?: number }) =>
        request<{ id: string }>('POST', `/v1/admin/devices/${deviceId}/commands`, body),
    },
  },
};
