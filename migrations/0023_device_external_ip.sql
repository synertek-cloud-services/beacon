-- External IP: the device's public-facing IP address as observed by the
-- worker at check-in time (Cloudflare's CF-Connecting-IP header) — not
-- agent-collected, since an agent has no reliable way to determine its own
-- public IP without an outbound call to a third-party echo service.
ALTER TABLE devices ADD COLUMN external_ip TEXT;
