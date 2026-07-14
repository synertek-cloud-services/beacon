-- Warranty expiration is a manually-entered fact, not agent-collected — no
-- OS/hardware API on any platform exposes OEM warranty status. A real
-- auto-lookup would mean per-vendor API integrations (Dell/HP/Lenovo, each
-- gated behind its own partner registration); this is a technician-entered
-- date field instead.
ALTER TABLE devices ADD COLUMN warranty_expires_at INTEGER;
