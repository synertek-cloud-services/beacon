-- Add OS targeting to components: null = all platforms, 'windows'/'linux'/'darwin' = specific OS only.
-- Jobs skip devices whose os_type doesn't match a component's target_os at dispatch time.

ALTER TABLE components ADD COLUMN target_os TEXT DEFAULT NULL;

-- Tag existing OS-specific ComStore components
UPDATE components SET target_os = 'windows' WHERE id IN ('store_clear_win_temp', 'store-restart-agent');
UPDATE components SET target_os = 'linux'   WHERE id IN ('store-restart-agent-linux', 'store-reinstall-agent-linux');

-- Fix Restart Agent (Linux): background the systemctl call so the script can exit
-- and report completion before the agent process is killed by the service manager.
UPDATE components SET
  script = 'nohup sh -c ''sleep 5 && systemctl restart beacon-agent'' >/dev/null 2>&1 &
echo "Agent restart scheduled. Service will restart in ~5 seconds."',
  updated_at = unixepoch()
WHERE id = 'store-restart-agent-linux';

-- Fix Reinstall Agent (Linux): same delayed restart at the end
UPDATE components SET
  script = '# Downloads and reinstalls the Beacon agent binary in-place without re-enrolling.
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

echo "Binary replaced. Scheduling service restart..."
nohup sh -c ''sleep 5 && systemctl restart beacon-agent'' >/dev/null 2>&1 &
echo "Done. Agent will reconnect shortly."',
  updated_at = unixepoch()
WHERE id = 'store-reinstall-agent-linux';
