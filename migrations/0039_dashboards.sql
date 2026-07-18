-- Shared, host-wide dashboards. Templates live in the Worker so the shipped
-- Default and Blank options remain immutable; this seeds one editable copy.
CREATE TABLE dashboards (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_home    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_dashboards_one_home ON dashboards(is_home) WHERE is_home = 1;

CREATE TABLE dashboard_sites (
  dashboard_id TEXT    NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  tenant_id    TEXT    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (dashboard_id, tenant_id)
);
CREATE INDEX idx_dashboard_sites_tenant ON dashboard_sites(tenant_id);

CREATE TABLE dashboard_widgets (
  id           TEXT    PRIMARY KEY,
  dashboard_id TEXT    NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,
  title        TEXT,
  config       TEXT    NOT NULL DEFAULT '{}',
  grid_x       INTEGER NOT NULL DEFAULT 0,
  grid_y       INTEGER NOT NULL DEFAULT 0,
  grid_w       INTEGER NOT NULL DEFAULT 4,
  grid_h       INTEGER NOT NULL DEFAULT 3,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id, sort_order);

INSERT INTO dashboards (id, name, sort_order, is_home, created_at, updated_at)
VALUES ('default-dashboard', 'Default Dashboard', 0, 1, unixepoch(), unixepoch());

INSERT INTO dashboard_widgets (id, dashboard_id, type, grid_x, grid_y, grid_w, grid_h, sort_order, created_at, updated_at) VALUES
  ('default-summary',       'default-dashboard', 'device_summary',       0,  0, 12, 2,  0, unixepoch(), unixepoch()),
  ('default-recent-alerts', 'default-dashboard', 'recent_alerts',        0,  2, 12, 5,  1, unixepoch(), unixepoch()),
  ('default-online',        'default-dashboard', 'online_offline',      0,  7,  4, 3,  2, unixepoch(), unixepoch()),
  ('default-os',            'default-dashboard', 'os_distribution',    4,  7,  4, 3,  3, unixepoch(), unixepoch()),
  ('default-class',         'default-dashboard', 'class_distribution', 8,  7,  4, 3,  4, unixepoch(), unixepoch()),
  ('default-offline',       'default-dashboard', 'offline_by_type',    0, 10,  4, 3,  5, unixepoch(), unixepoch()),
  ('default-antivirus',     'default-dashboard', 'antivirus_status',   4, 10,  4, 3,  6, unixepoch(), unixepoch()),
  ('default-priority',      'default-dashboard', 'alerts_by_priority', 8, 10,  4, 3,  7, unixepoch(), unixepoch());
