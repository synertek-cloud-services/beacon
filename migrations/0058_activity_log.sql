-- Master Activity Log: accountability ("who did what") + fleet-wide operational
-- visibility. See worker/src/lib/activityLog.ts for the two-layer instrumentation
-- that writes to this table: a generic Hono middleware covering the vast
-- majority of user-triggered admin/auth/session/branding mutations for free
-- (keyed off method + matched route pattern, after the handler succeeds), plus
-- a handful of explicit logActivity() calls for system/cron-triggered mutations
-- that never go through a user-authenticated HTTP route at all (alert
-- fire/resolve, scheduled job dispatch, patch policy auto-approval/dispatch),
-- and for login/SSO events, which have no bearer token yet to resolve an actor
-- from generically. Deliberately NO FK constraints on actor_id/entity_id/
-- tenant_id -- this table must never cascade-delete, or be blocked from
-- writing, just because it recorded something about a user/entity/site that's
-- since been removed. actor_label is a display-time snapshot for the same
-- "survive the referenced row's deletion" reason patch_approvals already
-- established for title/severity. entity_id is NOT similarly snapshotted --
-- the Activity Log UI does a best-effort live join against the current entity
-- table for a friendly name, falling back to the raw id / "(deleted)",
-- matching how DeviceChangeLogPage/JobsPage already show live-joined rather
-- than snapshotted entity data. Pruned by activityLog.ts's pruneActivityLog(),
-- called from the scheduled() cron, throttled via host_settings.activity_log_pruned_at.
CREATE TABLE activity_log (
  id          TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  actor_type  TEXT    NOT NULL CHECK (actor_type IN ('user', 'system', 'break-glass')),
  actor_id    TEXT,
  actor_label TEXT,
  category    TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  tenant_id   TEXT,
  method      TEXT    NOT NULL,
  path        TEXT,
  details     TEXT
);

CREATE INDEX idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX idx_activity_log_tenant     ON activity_log(tenant_id, created_at DESC);
CREATE INDEX idx_activity_log_actor      ON activity_log(actor_id, created_at DESC);
CREATE INDEX idx_activity_log_category   ON activity_log(category, created_at DESC);
CREATE INDEX idx_activity_log_entity     ON activity_log(entity_type, entity_id);

-- Retention-prune throttle -- reuses the existing id=1 singleton row rather
-- than a stateless cron-tick bucket, so a missed/delayed cron tick can't
-- silently skip an entire day's prune.
ALTER TABLE host_settings ADD COLUMN activity_log_pruned_at INTEGER;
