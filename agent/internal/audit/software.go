package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/synertekcs/beacon/agent/internal/protocol"
)

func collectSoftware() ([]protocol.SoftwareItem, error) {
	switch runtime.GOOS {
	case "linux":
		return collectSoftwareLinux()
	case "windows":
		return collectSoftwareWindows()
	case "darwin":
		return collectSoftwareDarwin()
	}
	return nil, nil
}

func collectSoftwareLinux() ([]protocol.SoftwareItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Try dpkg first (Debian/Ubuntu)
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		out, err := exec.CommandContext(ctx,
			"dpkg-query", "-W", `-f=${Package}\t${Version}\t${Maintainer}\n`,
		).Output()
		if err == nil {
			return parseDpkgOutput(string(out)), nil
		}
	}

	// Fall back to rpm (RHEL/Fedora/SUSE)
	if _, err := exec.LookPath("rpm"); err == nil {
		out, err := exec.CommandContext(ctx,
			"rpm", "-qa", "--queryformat", `%{NAME}\t%{VERSION}\t%{VENDOR}\n`,
		).Output()
		if err == nil {
			return parseRPMOutput(string(out)), nil
		}
	}

	log.Println("audit/software: no supported package manager found (dpkg, rpm)")
	return nil, nil
}

func parseDpkgOutput(output string) []protocol.SoftwareItem {
	var items []protocol.SoftwareItem
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "\t", 3)
		if len(fields) < 2 || fields[0] == "" {
			continue
		}
		publisher := ""
		if len(fields) == 3 {
			publisher = strings.TrimSpace(fields[2])
		}
		items = append(items, protocol.SoftwareItem{
			Name:      strings.TrimSpace(fields[0]),
			Version:   strings.TrimSpace(fields[1]),
			Publisher: publisher,
		})
	}
	return items
}

func parseRPMOutput(output string) []protocol.SoftwareItem {
	var items []protocol.SoftwareItem
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "\t", 3)
		if len(fields) < 2 || fields[0] == "" {
			continue
		}
		publisher := ""
		if len(fields) == 3 {
			publisher = strings.TrimSpace(fields[2])
		}
		items = append(items, protocol.SoftwareItem{
			Name:      strings.TrimSpace(fields[0]),
			Version:   strings.TrimSpace(fields[1]),
			Publisher: publisher,
		})
	}
	return items
}

func collectSoftwareWindows() ([]protocol.SoftwareItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ps := `@(
		'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
		'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
	) | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
	Where-Object { $_.DisplayName } |
	Select-Object DisplayName,DisplayVersion,Publisher,InstallDate |
	ConvertTo-Json -Compress`

	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", ps,
	).Output()
	if err != nil {
		return nil, err
	}

	// Handle both array and single-object responses
	raw := strings.TrimSpace(string(out))
	if raw == "" || raw == "null" {
		return nil, nil
	}

	type psItem struct {
		DisplayName    string `json:"DisplayName"`
		DisplayVersion string `json:"DisplayVersion"`
		Publisher      string `json:"Publisher"`
		InstallDate    string `json:"InstallDate"`
	}

	var items []psItem
	if raw[0] == '[' {
		if err := json.Unmarshal([]byte(raw), &items); err != nil {
			return nil, err
		}
	} else {
		var single psItem
		if err := json.Unmarshal([]byte(raw), &single); err != nil {
			return nil, err
		}
		items = []psItem{single}
	}

	seen := map[string]bool{}
	var result []protocol.SoftwareItem
	for _, it := range items {
		name := strings.TrimSpace(it.DisplayName)
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		seen[strings.ToLower(name)] = true
		result = append(result, protocol.SoftwareItem{
			Name:        name,
			Version:     strings.TrimSpace(it.DisplayVersion),
			Publisher:   strings.TrimSpace(it.Publisher),
			InstalledAt: strings.TrimSpace(it.InstallDate),
		})
	}
	return result, nil
}

func collectSoftwareDarwin() ([]protocol.SoftwareItem, error) {
	entries, err := os.ReadDir("/Applications")
	if err != nil {
		return nil, err
	}
	var items []protocol.SoftwareItem
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".app") {
			continue
		}
		appPath := filepath.Join("/Applications", entry.Name())
		plist := filepath.Join(appPath, "Contents", "Info.plist")
		name, version := parseMacOSPlist(plist)
		if name == "" {
			name = strings.TrimSuffix(entry.Name(), ".app")
		}
		// Use mod time of the .app bundle as a proxy for install date
		info, err := os.Stat(appPath)
		installDate := ""
		if err == nil {
			installDate = info.ModTime().Format("2006-01-02")
		}
		items = append(items, protocol.SoftwareItem{
			Name:        name,
			Version:     version,
			InstalledAt: installDate,
		})
	}
	return items, nil
}

// parseMacOSPlist extracts CFBundleName and CFBundleShortVersionString from an Info.plist.
func parseMacOSPlist(path string) (name, version string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", ""
	}
	content := string(data)

	extract := func(key string) string {
		idx := strings.Index(content, "<key>"+key+"</key>")
		if idx < 0 {
			return ""
		}
		rest := content[idx+len("<key>"+key+"</key>"):]
		start := strings.Index(rest, "<string>")
		end := strings.Index(rest, "</string>")
		if start < 0 || end < 0 || end <= start {
			return ""
		}
		return strings.TrimSpace(rest[start+8 : end])
	}

	name = extract("CFBundleName")
	if name == "" {
		name = extract("CFBundleDisplayName")
	}
	version = extract("CFBundleShortVersionString")
	return name, version
}
