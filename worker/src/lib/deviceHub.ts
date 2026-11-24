import type { Bindings } from '../index';

// Nudge a device's open DeviceHub socket so it checks in immediately. Entirely
// best-effort: absent binding (older wrangler.toml), no connected agent, or any
// error all just mean the agent picks the work up on its next poll.
export async function wakeDevice(env: Pick<Bindings, 'DEVICE_HUB'>, deviceId: string): Promise<void> {
  if (!env.DEVICE_HUB) return;
  try {
    const stub = env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName(deviceId));
    await stub.fetch('https://device-hub/wake', { method: 'POST' });
  } catch { /* best effort */ }
}
