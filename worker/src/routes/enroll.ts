import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import type { EnrollRequest, EnrollResponse } from '../lib/types';
import { sha256hex, generateToken } from '../lib/crypto';

const enroll = new Hono<{ Bindings: Bindings }>();

enroll.post('/', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'missing authorization' }, 401);
  }
  const rawToken = auth.slice(7);
  const tokenHash = await sha256hex(rawToken);

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const token = await db.select()
    .from(schema.enrollmentTokens)
    .where(eq(schema.enrollmentTokens.tokenHash, tokenHash))
    .get();

  if (!token) return c.json({ error: 'invalid token' }, 401);
  if (token.revokedAt !== null) return c.json({ error: 'token revoked' }, 401);
  if (token.expiresAt !== null && token.expiresAt < now) return c.json({ error: 'token expired' }, 401);
  if (token.maxUses !== null && token.useCount >= token.maxUses) return c.json({ error: 'token use limit reached' }, 401);

  const tenant = await db.select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, token.tenantId))
    .get();

  if (!tenant || tenant.status !== 'active') {
    return c.json({ error: 'tenant not found or inactive' }, 403);
  }

  let body: EnrollRequest;
  try {
    body = await c.req.json<EnrollRequest>();
  } catch {
    return c.json({ error: 'invalid request body' }, 400);
  }

  const deviceId = crypto.randomUUID();
  const deviceCredential = generateToken();
  const deviceCredentialHash = await sha256hex(deviceCredential);

  // token.auto_approve takes precedence over tenant default when set
  const autoApprove = token.autoApprove !== null ? token.autoApprove : tenant.autoApproveDefault;
  const status = autoApprove ? 'approved' : 'pending';

  await db.insert(schema.devices).values({
    id: deviceId,
    tenantId: token.tenantId,
    enrollmentTokenId: token.id,
    agentType: token.agentType,
    deviceCredentialHash,
    status,
    hostname: body.hostname,
    osType: body.os_type,
    osVersion: body.os_version,
    detectedClass: body.detected_class,
    agentVersion: body.agent_version,
    inventory: JSON.stringify(body),
    createdAt: now,
    approvedAt: autoApprove ? now : null,
  });

  await db.update(schema.enrollmentTokens)
    .set({ useCount: token.useCount + 1 })
    .where(eq(schema.enrollmentTokens.id, token.id));

  return c.json<EnrollResponse>({
    device_id: deviceId,
    tenant_id: token.tenantId,
    device_credential: deviceCredential,
    status,
  });
});

export default enroll;
