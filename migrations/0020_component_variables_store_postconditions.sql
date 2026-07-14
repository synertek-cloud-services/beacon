-- Component input variables: prompted at job-creation time, injected into
-- the agent's script execution as environment variables (always strings).
CREATE TABLE component_variables (
  id             TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  component_id   TEXT    NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,  -- env var name injected into the script, e.g. "BACKUP_PATH"
  label          TEXT    NOT NULL,  -- human-friendly prompt label shown in Create Job modal
  type           TEXT    NOT NULL DEFAULT 'string', -- 'string' | 'selection' | 'boolean' | 'date'
  options        TEXT,   -- JSON [{label,value}], only for type='selection'
  default_value  TEXT,   -- always a string, regardless of declared type
  description    TEXT,
  required       INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_component_variables_component ON component_variables(component_id);

-- Components: ComStore provenance ('custom' | 'store') and post-condition
-- output-matching rules (flag a completed command as "Warning" without
-- changing its actual completed/failed status).
ALTER TABLE components ADD COLUMN origin TEXT NOT NULL DEFAULT 'custom';
-- JSON: [{id, stream:'stdout'|'stderr'|'both', match_type:'contains'|'regex', pattern, enabled}]
ALTER TABLE components ADD COLUMN post_conditions TEXT NOT NULL DEFAULT '[]';

-- Commands: non-authoritative warning flag, orthogonal to status
ALTER TABLE commands ADD COLUMN warning INTEGER NOT NULL DEFAULT 0;

-- ── ComStore seed: a handful of trivial built-in example components ──
INSERT INTO components (id, name, description, category, type, origin, shell, script, timeout_seconds, created_at, updated_at) VALUES
('store_clear_win_temp', 'Clear Windows Temp Files', 'Deletes files under %TEMP% and C:\Windows\Temp.', 'Maintenance', 'script', 'store', 'powershell',
 'Remove-Item -Path "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue' || char(10) ||
 'Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue' || char(10) ||
 'Write-Output "Temp files cleared."', 300, unixepoch(), unixepoch()),
('store_clear_nix_tmp', 'Clear /tmp (Linux/macOS)', 'Removes files under /tmp older than 1 day.', 'Maintenance', 'script', 'store', 'bash',
 'find /tmp -type f -mtime +1 -delete' || char(10) || 'echo "Temp files cleared."', 300, unixepoch(), unixepoch()),
('store_flush_dns', 'Flush DNS Cache', 'Flushes the OS DNS resolver cache.', 'Maintenance', 'script', 'store', 'auto',
 'if ($IsWindows -or $env:OS -eq "Windows_NT") { ipconfig /flushdns } else { echo "DNS flush is a no-op on this OS." }', 60, unixepoch(), unixepoch()),
('store_list_software', 'List Installed Software', 'Prints installed software name + version to stdout.', 'Diagnostic', 'script', 'store', 'auto',
 'if ($IsWindows -or $env:OS -eq "Windows_NT") { Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Select-Object DisplayName,DisplayVersion | Format-Table -AutoSize } else { echo "Use the Audit feature for full software inventory on this OS." }', 120, unixepoch(), unixepoch());
