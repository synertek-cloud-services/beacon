-- Network Discovery (v1: live-host sweep) — a designated always-on "probe"
-- device per company periodically pings-sweeps a configured CIDR range and
-- cross-references the OS ARP table for MAC, reporting live hosts back.
-- Scans dispatch through the existing commands table (same one-shot
-- mechanism as install_patches/run_audit), not the check-in wire protocol.
CREATE TABLE network_discovery_configs (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  probe_device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  enabled                INTEGER NOT NULL DEFAULT 1,
  cidr_ranges            TEXT NOT NULL, -- JSON string[], e.g. ["192.168.1.0/24"]
  scan_interval_minutes  INTEGER NOT NULL DEFAULT 360,
  last_scanned_at        INTEGER, -- nullable
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

-- Keyed by (company_id, ip_address), not MAC -- simpler upsert; a
-- DHCP-reassigned IP can appear as a "new" device, an accepted v1
-- simplification. MAC is only resolvable when the probe and target share an
-- L2 segment (ARP doesn't cross routers).
CREATE TABLE discovered_devices (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ip_address     TEXT NOT NULL,
  mac_address    TEXT,
  hostname       TEXT,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  times_seen     INTEGER NOT NULL DEFAULT 1,
  dismissed      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, ip_address)
);
