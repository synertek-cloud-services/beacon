-- Credentialed Network Discovery (issue #78). Extends the v1 ping+ARP
-- sweep with optional SNMP v1/v2c and SSH (password-only) fingerprinting
-- of already-discovered live hosts -- WinRM stays deferred (higher-risk
-- auth negotiation, no first-party Go client). Credentials are NOT stored
-- here: per-company scan credentials live in company_variables under a
-- fixed key-name convention (CV_SNMP_COMMUNITY, CV_SSH_USERNAME,
-- CV_SSH_PASSWORD), matching the issue's own instruction that Company
-- Variables/Secrets are the intended credential home. These two flags are
-- purely the per-company opt-in toggles.
ALTER TABLE network_discovery_configs ADD COLUMN snmp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE network_discovery_configs ADD COLUMN ssh_enabled INTEGER NOT NULL DEFAULT 0;

-- All nullable -- only set once a credentialed (or, for open_ports, a
-- pre-auth port/response-check) probe actually finds something; a scan
-- that finds nothing new never blanks out a previous result, same rule
-- the existing mac_address/hostname upsert in recordDiscoveredHosts
-- already follows. open_ports is JSON int[] (e.g. [22,161]) -- populated
-- by the port/response-check gate even when the subsequent credentialed
-- step fails or isn't attempted, so it has standalone value on its own.
-- snmp_sys_descr/snmp_sys_name are the raw values of the two universal
-- MIB-II System-group OIDs (1.3.6.1.2.1.1.1.0 / 1.3.6.1.2.1.1.5.0) --
-- no custom OID configuration in v1. ssh_banner is the server's SSH
-- version string; ssh_os_info is the stdout of one single fixed
-- non-interactive command (`uname -a`), not a configurable command
-- builder.
ALTER TABLE discovered_devices ADD COLUMN open_ports TEXT;
ALTER TABLE discovered_devices ADD COLUMN snmp_sys_descr TEXT;
ALTER TABLE discovered_devices ADD COLUMN snmp_sys_name TEXT;
ALTER TABLE discovered_devices ADD COLUMN ssh_banner TEXT;
ALTER TABLE discovered_devices ADD COLUMN ssh_os_info TEXT;
