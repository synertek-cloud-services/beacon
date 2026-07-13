import { sha256hex } from './crypto';

// Hash-then-compare rather than string equality, so a wrong ADMIN_SECRET
// guess can't be narrowed down by measuring per-character response timing.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256hex(a), sha256hex(b)]);
  return hashA === hashB;
}

export async function requireAdmin(auth: string | undefined | null, secret: string): Promise<boolean> {
  if (!auth) return false;
  return timingSafeEqual(auth, `Bearer ${secret}`);
}
