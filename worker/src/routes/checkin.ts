import { Hono } from 'hono';
import type { Bindings } from '../index';
import type { CheckInRequest, CheckInResponse } from '../lib/types';

const checkin = new Hono<{ Bindings: Bindings }>();

checkin.post('/', async (c) => {
  // TODO Phase 1
  // 1. Extract Bearer token (device credential) from Authorization header
  // 2. SHA-256 hash it; look up device by device_credential_hash
  // 3. Return 401 if not found; 403 if status = revoked
  // 4. Parse CheckInRequest body; validate device_id + tenant_id match record
  // 5. Update: last_seen, agent_version, hostname, os_type, os_version,
  //    detected_class (always recomputed — never touches override_class),
  //    inventory (full metrics blob as JSON)
  // 6. If status = pending: return empty commands (no command eligibility)
  // 7. Phase 2+: process pending_command_results; fetch next queued commands
  const _body = await c.req.json<CheckInRequest>();
  return c.json<CheckInResponse>({ commands: [] });
});

export default checkin;
