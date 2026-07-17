-- Clarify existing Windows-only component names and add Linux equivalents

UPDATE components SET name = 'Restart Agent (Windows)' WHERE id = 'store-restart-agent';

INSERT INTO components (id, name, type, origin, scope, category, shell, script, post_conditions, created_at, updated_at)
VALUES
  (
    'store-restart-agent-linux',
    'Restart Agent (Linux)',
    'script',
    'store',
    'global',
    'Agent Management',
    'bash',
    '# Restarts the Beacon agent service on a Linux device.
# Equivalent to the Restart Agent action on the device detail page,
# but available as a job component for bulk or scheduled execution.

systemctl restart beacon-agent
echo "Agent service restarted."',
    '[]',
    unixepoch(),
    unixepoch()
  ),
  (
    'store-reinstall-agent-linux',
    'Reinstall Agent (Linux)',
    'script',
    'store',
    'global',
    'Agent Management',
    'bash',
    '# Downloads and reinstalls the Beacon agent binary in-place without re-enrolling.
# Detects CPU architecture automatically (amd64 or arm64).
# Set SERVER_URL to your Beacon worker URL (e.g. https://rmm-api.example.com).

if [ -z "$SERVER_URL" ]; then echo "SERVER_URL variable is required" >&2; exit 1; fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

INSTALL_PATH="/usr/local/bin/beacon-agent"
TEMP_PATH="/tmp/beacon-agent-new"

echo "Downloading latest agent (linux/$ARCH) from $SERVER_URL ..."
curl -fsSL "$SERVER_URL/v1/agent/download?os=linux&arch=$ARCH" -o "$TEMP_PATH"
chmod +x "$TEMP_PATH"

cp "$INSTALL_PATH" "${INSTALL_PATH}.bak" 2>/dev/null || true
mv -f "$TEMP_PATH" "$INSTALL_PATH"

echo "Binary replaced. Restarting service..."
systemctl restart beacon-agent
echo "Done. Agent will reconnect shortly."',
    '[]',
    unixepoch(),
    unixepoch()
  );

-- SERVER_URL variable for the Linux reinstall component
INSERT INTO component_variables (id, component_id, name, label, type, options, default_value, description, required, sort_order)
VALUES (
  'store-reinstall-agent-linux-serverurl',
  'store-reinstall-agent-linux',
  'SERVER_URL',
  'Server URL',
  'string',
  NULL,
  '',
  'Beacon worker base URL (e.g. https://rmm-api.example.com). Used to download the latest agent binary.',
  1,
  0
);
