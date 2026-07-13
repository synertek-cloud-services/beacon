import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { sha256hex } from './crypto';
import * as schema from '../db/schema';
import type { Bindings } from '../index';

// Hash-then-compare rather than string equality, so a wrong ADMIN_SECRET
// guess can't be narrowed down by measuring per-character response timing.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256hex(a), sha256hex(b)]);
  return hashA === hashB;
}

// Kept working indefinitely as a break-glass bootstrap/recovery bearer token —
// never exposed in the dashboard UI, but every route still accepts it (see requireUser).
export async function requireAdmin(auth: string | undefined | null, secret: string): Promise<boolean> {
  if (!auth) return false;
  return timingSafeEqual(auth, `Bearer ${secret}`);
}

export type Role = 'admin' | 'technician' | 'readonly';

const ROLE_RANK: Record<Role, number> = { readonly: 0, technician: 1, admin: 2 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// Used when a user's SSO group memberships match more than one role mapping.
export function highestRole(roles: Role[]): Role | null {
  return roles.reduce<Role | null>((best, r) => (!best || ROLE_RANK[r] > ROLE_RANK[best] ? r : best), null);
}

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  source: 'break-glass' | 'session';
}

// Only bump last_used_at if it's gone stale — avoids a D1 write on every single
// authenticated request (same write-volume concern the check_interval_minutes work
// addressed for policy monitors).
const LAST_USED_THROTTLE_SECONDS = 5 * 60;

// Accepts either a real user session bearer token, or the ADMIN_SECRET break-glass
// token (kept working indefinitely — see requireAdmin above).
export async function requireUser(
  authHeader: string | undefined | null,
  env: Bindings,
  minRole: Role = 'readonly',
): Promise<AuthedUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);

  if (await timingSafeEqual(authHeader, `Bearer ${env.ADMIN_SECRET}`)) {
    return { id: 'break-glass', email: 'break-glass@local', displayName: null, role: 'admin', source: 'break-glass' };
  }

  const db = drizzle(env.DB, { schema });
  const tokenHash = await sha256hex(token);
  const now = Math.floor(Date.now() / 1000);

  const row = await db
    .select({
      sessionId: schema.userSessions.id,
      expiresAt: schema.userSessions.expiresAt,
      revokedAt: schema.userSessions.revokedAt,
      lastUsedAt: schema.userSessions.lastUsedAt,
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      status: schema.users.status,
    })
    .from(schema.userSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.userSessions.userId))
    .where(eq(schema.userSessions.tokenHash, tokenHash))
    .get();

  if (!row || row.revokedAt || row.expiresAt < now || row.status !== 'active') return null;
  if (!roleAtLeast(row.role, minRole)) return null;

  if (!row.lastUsedAt || now - row.lastUsedAt > LAST_USED_THROTTLE_SECONDS) {
    await db.update(schema.userSessions).set({ lastUsedAt: now }).where(eq(schema.userSessions.id, row.sessionId));
  }

  return { id: row.userId, email: row.email, displayName: row.displayName, role: row.role, source: 'session' };
}
