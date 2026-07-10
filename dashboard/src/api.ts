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

  devices: {
    list: (status?: DeviceStatus) =>
      request<Device[]>('GET', `/v1/admin/devices${status ? `?status=${status}` : ''}`),
    get: (id: string) =>
      request<Device>('GET', `/v1/admin/devices/${id}`),
    approve: (id: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/approve`),
    revoke: (id: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/devices/${id}/revoke`),
  },
};
