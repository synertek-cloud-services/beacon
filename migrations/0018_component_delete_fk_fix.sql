-- Fix: DELETE /v1/admin/components/:id threw an unhandled foreign-key
-- constraint error whenever the component had ever been used in a job.
-- commands.component_id REFERENCES components(id) with no ON DELETE
-- clause defaults to NO ACTION, and D1 enforces foreign keys. SQLite
-- can't ALTER a column's FK constraint in place, so recreate the table
-- with ON DELETE SET NULL — this matches what the dashboard's own
-- delete-confirmation dialog already claims happens ("existing job
-- records that used this component will retain their script output"),
-- and the UI already falls back gracefully when component_id/name is
-- null (JobsPage.vue: cmd.componentName ?? `Step ${cmd.componentOrder}`).

CREATE TABLE commands_new (
  id              TEXT    PRIMARY KEY NOT NULL,
  device_id       TEXT    NOT NULL,
  tenant_id       TEXT    NOT NULL,
  type            TEXT    NOT NULL,
  payload         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'queued',
  result          TEXT,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  job_id          TEXT REFERENCES jobs(id),
  component_id    TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_order INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (device_id) REFERENCES devices(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

INSERT INTO commands_new
  (id, device_id, tenant_id, type, payload, status, result, created_at, completed_at, job_id, component_id, component_order)
SELECT
  id, device_id, tenant_id, type, payload, status, result, created_at, completed_at, job_id, component_id, component_order
FROM commands;

DROP TABLE commands;

ALTER TABLE commands_new RENAME TO commands;
