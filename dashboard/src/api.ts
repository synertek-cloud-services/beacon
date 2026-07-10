// In dev, Vite proxies /v1/* to localhost:8787 (see vite.config.ts).
// In production set VITE_API_URL to the deployed worker URL.
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

export interface Tenant {
  id: string;
  name: string;
  autoApproveDefault: boolean;
  privacyModeDefault: boolean;
  status: 'active' | 'suspended';
  createdAt: number;
  deviceCount: number;
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

export const api = {
  saveSecret(s: string) {
    localStorage.setItem('beacon_secret', s);
  },

  clearSecret() {
    localStorage.removeItem('beacon_secret');
  },

  hasSecret(): boolean {
    return !!secret();
  },

  tenants: {
    list: () => request<Tenant[]>('GET', '/v1/admin/tenants'),
    create: (body: { name: string; auto_approve_default?: boolean; privacy_mode_default?: boolean }) =>
      request<Tenant>('POST', '/v1/admin/tenants', body),
    update: (id: string, body: { name?: string; auto_approve_default?: boolean; privacy_mode_default?: boolean; status?: 'active' | 'suspended' }) =>
      request<{ ok: boolean }>('PATCH', `/v1/admin/tenants/${id}`, body),
    tokens: {
      list: (tenantId: string) => request<EnrollmentToken[]>('GET', `/v1/admin/tenants/${tenantId}/tokens`),
      create: (tenantId: string, body: { auto_approve?: boolean | null; max_uses?: number | null; expires_in_days?: number | null }) =>
        request<{ id: string; raw_token: string; expires_at: number | null; max_uses: number | null }>('POST', `/v1/admin/tenants/${tenantId}/tokens`, body),
      revoke: (tenantId: string, tokenId: string) =>
        request<{ ok: boolean }>('DELETE', `/v1/admin/tenants/${tenantId}/tokens/${tokenId}`),
    },
  },

  summary: {
    get: () => request<Summary>('GET', '/v1/admin/summary'),
  },

  devices: {
    list: (status?: DeviceStatus) =>
      request<Device[]>('GET', `/v1/admin/devices${status ? `?status=${status}` : ''}`),
    get: (id: string) =>
      request<Device>('GET', `/v1/admin/devices/${id}`),
    approve: (id: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/approve`),
    revoke: (id: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/revoke`),
    delete: (id: string) =>
      request<{ ok: boolean }>('DELETE', `/v1/admin/devices/${id}`),
  },
};
