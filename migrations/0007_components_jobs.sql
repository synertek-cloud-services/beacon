-- Component library: reusable script payloads
CREATE TABLE components (
  id              TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name            TEXT    NOT NULL,
  description     TEXT,
  category        TEXT,   -- 'maintenance' | 'diagnostic' | 'deployment' | 'monitoring' | null
  type            TEXT    NOT NULL DEFAULT 'script',  -- 'script' | 'application'
  shell           TEXT    NOT NULL DEFAULT 'auto',    -- 'auto' | 'powershell' | 'bash' | 'sh' | 'cmd'
  script          TEXT    NOT NULL DEFAULT '',
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Job definitions: delivery mechanism (bundles one or more components, targets devices)
CREATE TABLE jobs (
  id             TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name           TEXT    NOT NULL,
  description    TEXT,
  type           TEXT    NOT NULL DEFAULT 'quick',   -- 'quick' | 'scheduled'
  status         TEXT    NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'cancelled'
  -- JSON: [{type:'library',component_id,order} | {type:'inline',shell,script,timeout_seconds,order}]
  component_ids  TEXT    NOT NULL DEFAULT '[]',
  target_type    TEXT    NOT NULL DEFAULT 'devices', -- 'devices' | 'tenants' | 'all'
  target_ids     TEXT    NOT NULL DEFAULT '[]',      -- JSON array of device or tenant IDs
  run_as_system  INTEGER NOT NULL DEFAULT 1,
  scheduled_at   INTEGER,   -- null = run immediately (quick jobs)
  expires_at     INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by     TEXT
);

-- Link dispatched commands back to a job and which component they're running
ALTER TABLE commands ADD COLUMN job_id           TEXT REFERENCES jobs(id);
ALTER TABLE commands ADD COLUMN component_id     TEXT REFERENCES components(id);
ALTER TABLE commands ADD COLUMN component_order  INTEGER NOT NULL DEFAULT 1;
