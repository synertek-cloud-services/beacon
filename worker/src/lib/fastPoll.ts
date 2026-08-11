import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

// The agent's default check-in interval is 60s (agent/cmd/agent/main.go's
// checkInInterval) -- while a fast-poll window is active for a device, its
// check-in response instead asks for this much shorter cadence instead, so
// a technician actively working on that one device (opening a Remote
// Shell/Web Remote session, dispatching a direct command) doesn't wait up
// to a full minute for each subsequent action to be picked up. One fixed
// value, not a builder -- matches this codebase's established "no more
// config than needed" convention (e.g. the reboot marker's fixed 1-hour
// snooze).
export const FAST_POLL_INTERVAL_SECONDS = 15;

// How long a single trigger keeps the window open. Reset (not accumulated)
// on every trigger, so a technician taking several actions in a row keeps
// the window continuously warm without it growing unbounded.
const FAST_POLL_WINDOW_SECONDS = 15 * 60;

// Arms/resets a device's fast-poll window to now + 15min -- mirrors
// devices.maintenanceEndsAt's exact "set an absolute future timestamp,
// self-expiring, re-evaluated live every check-in" shape (see
// worker/src/lib/maintenance.ts's isDeviceSuppressed), not a separate
// cron-swept flag.
//
// Called as a side effect of technician-initiated, single-device actions
// only -- see worker/src/routes/sessions.ts (any session type, including
// Elevate) and worker/src/routes/admin/devices.ts's POST /:id/commands
// (any direct command type). Deliberately NOT called from Job dispatch
// (worker/src/routes/admin/jobs.ts) -- a Job can target many devices at
// once, and this must never fan fast-poll out across a whole targeted
// fleet as a side effect of one scheduled/bulk dispatch.
export async function extendFastPoll(db: Db, deviceId: string, now: number): Promise<void> {
  await db.update(schema.devices)
    .set({ fastPollUntil: now + FAST_POLL_WINDOW_SECONDS })
    .where(eq(schema.devices.id, deviceId));
}

// Pure read -- mirrors isDeviceSuppressed's own inline timestamp-comparison
// style. Takes the already-fetched device row rather than querying again,
// since every call site (worker/src/routes/checkin.ts) already has it in
// hand from earlier in the same request.
export function isFastPollActive(device: { fastPollUntil: number | null }, now: number): boolean {
  return device.fastPollUntil != null && device.fastPollUntil > now;
}
