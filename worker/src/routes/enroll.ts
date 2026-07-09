import { Hono } from 'hono';
import type { Bindings } from '../index';
import type { EnrollRequest, EnrollResponse } from '../lib/types';

const enroll = new Hono<{ Bindings: Bindings }>();

enroll.post('/', async (c) => {
  // TODO Phase 1
  // 1. Extract Bearer token from Authorization header
  // 2. SHA-256 hash it; look up enrollment_token by token_hash
  // 3. Validate: not expired (expires_at), not revoked (revoked_at),
  //    max_uses not exceeded (use_count < max_uses or max_uses is null)
  // 4. Parse + validate EnrollRequest body
  // 5. Generate device_id (nanoid) and device_credential (crypto.randomBytes)
  // 6. Resolve auto_approve: token.auto_approve ?? tenant.auto_approve_default
  // 7. Insert devices row; status = approved or pending per above
  // 8. Increment enrollment_token.use_count
  // 9. Return EnrollResponse (credential always issued — pending devices can
  //    still check in; status controls command eligibility, not data ingestion)
  return c.json({ error: 'not implemented' }, 501);
});

export default enroll;
