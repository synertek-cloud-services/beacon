package audit

import (
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

func collectSecurity() (*protocol.SecurityInfo, error) {
	switch runtime.GOOS {
	case "windows":
		return collectSecurityWindows()
	case "linux":
		return collectSecurityLinux()
	}
	return nil, nil
}

func collectSecurityWindows() (*protocol.SecurityInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Query Windows Security Center for registered AV products.
	// Every AV (Defender, Malwarebytes, Norton, etc.) registers here automatically.
	avPS := `Get-WmiObject -Namespace root\SecurityCenter2 -Class AntiVirusProduct |` +
		` Select-Object displayName,productState | ConvertTo-Json -Compress`
	avOut, avErr := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", avPS,
	).Output()

	var avEntries []protocol.AVEntry
	if avErr == nil {
		raw := strings.TrimSpace(string(avOut))
		if raw != "" && raw != "null" {
			type psAV struct {
				DisplayName  string `json:"displayName"`
				ProductState int    `json:"productState"`
			}
			var list []psAV
			if raw[0] == '[' {
				json.Unmarshal([]byte(raw), &list) //nolint:errcheck
			} else {
				var single psAV
				if json.Unmarshal([]byte(raw), &single) == nil {
					list = []psAV{single}
				}
			}
			for _, av := range list {
				// productState bitmask: bits 12-15 = enabled state (1=on), bits 4-7 = signature state (0=up-to-date)
				enabled := ((av.ProductState >> 12) & 0xF) == 1
				upToDate := ((av.ProductState >> 4) & 0xF) == 0
				avEntries = append(avEntries, protocol.AVEntry{
					Name:     av.DisplayName,
					Enabled:  enabled,
					UpToDate: upToDate,
				})
			}
		}
	}

	// Query firewall state across all profiles (Domain, Private, Public).
	// FirewallEnabled = true if ANY profile is enabled.
	fwPS := `(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $true }).Count -gt 0`
	fwOut, fwErr := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", fwPS,
	).Output()
	firewallEnabled := false
	if fwErr == nil {
		firewallEnabled = strings.TrimSpace(string(fwOut)) == "True"
	}

	return &protocol.SecurityInfo{
		Antivirus:       avEntries,
		FirewallEnabled: firewallEnabled,
	}, nil
}

func collectSecurityLinux() (*protocol.SecurityInfo, error) {
	var avEntries []protocol.AVEntry

	// Detect ClamAV presence
	if _, err := exec.LookPath("clamscan"); err == nil {
		avEntries = append(avEntries, protocol.AVEntry{
			Name:    "ClamAV",
			Enabled: true,
			// Signature currency is expensive to determine; leave as default false
			UpToDate: false,
		})
	}

	firewallEnabled := false

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Check ufw first
	if _, err := exec.LookPath("ufw"); err == nil {
		out, err := exec.CommandContext(ctx, "ufw", "status").Output()
		if err == nil && strings.Contains(string(out), "Status: active") {
			firewallEnabled = true
		}
	}

	// Check firewalld if ufw didn't fire
	if !firewallEnabled {
		if _, err := exec.LookPath("firewall-cmd"); err == nil {
			out, err := exec.CommandContext(ctx, "firewall-cmd", "--state").Output()
			if err == nil && strings.TrimSpace(string(out)) == "running" {
				firewallEnabled = true
			}
		}
	}

	return &protocol.SecurityInfo{
		Antivirus:       avEntries,
		FirewallEnabled: firewallEnabled,
	}, nil
}
