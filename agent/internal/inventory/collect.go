package inventory

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/synertek-cloud-services/beacon/agent/internal/diskutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

type Snapshot struct {
	Hostname      string
	OSType        string
	OSVersion     string
	UptimeSeconds int64
	DiskFreeBytes int64
	Disks         []protocol.DiskInfo
	DetectedClass string
	CpuPercent    float64
	MemoryPercent float64
	AvStatus      string // "running_up_to_date" | "running_not_up_to_date" | "not_running" | "not_detected" | ""
	AvProduct     string // display name of detected AV
}

func Collect() (*Snapshot, error) {
	info, err := host.Info()
	if err != nil {
		return nil, fmt.Errorf("host info: %w", err)
	}

	sysDrive := "/"
	if runtime.GOOS == "windows" {
		sysDrive = `C:\`
	}
	du, err := disk.Usage(sysDrive)
	if err != nil {
		return nil, fmt.Errorf("disk usage: %w", err)
	}

	// cpu.Percent blocks for 200ms to sample usage; errors are non-fatal.
	cpuPcts, _ := cpu.Percent(200*time.Millisecond, false)
	var cpuPct float64
	if len(cpuPcts) > 0 {
		cpuPct = cpuPcts[0]
	}

	var memPct float64
	if vm, err := mem.VirtualMemory(); err == nil {
		memPct = vm.UsedPercent
	}

	avStatus, avProduct := collectAvStatus()
	disks, _ := diskutil.CollectDisks()

	return &Snapshot{
		Hostname:      info.Hostname,
		OSType:        runtime.GOOS,
		OSVersion:     fmt.Sprintf("%s %s", info.Platform, info.PlatformVersion),
		UptimeSeconds: int64(info.Uptime),
		DiskFreeBytes: int64(du.Free),
		Disks:         disks,
		DetectedClass: detectClass(info),
		CpuPercent:    cpuPct,
		MemoryPercent: memPct,
		AvStatus:      avStatus,
		AvProduct:     avProduct,
	}, nil
}

func detectClass(info *host.InfoStat) string {
	switch runtime.GOOS {
	case "windows":
		if strings.Contains(strings.ToLower(info.Platform), "server") ||
			strings.Contains(strings.ToLower(info.PlatformVersion), "server") {
			return "server"
		}
		if hasBatteryWindows() {
			return "laptop"
		}
		return "workstation"
	case "linux":
		if hasBattery() {
			return "laptop"
		}
		return "server"
	default:
		return "workstation"
	}
}

// hasBattery checks for a battery in /sys — reliable laptop indicator on Linux.
func hasBattery() bool {
	matches, _ := filepath.Glob("/sys/class/power_supply/BAT*")
	return len(matches) > 0
}

// hasBatteryWindows checks WMI Win32_Battery for any instances — the
// standard laptop indicator on Windows, mirroring hasBattery()'s /sys check
// on Linux. Any failure (query error, timeout, no WMI provider) falls back
// to false/"not a laptop" rather than a separate unknown state, same
// fail-safe-to-workstation posture the rest of this function already has.
func hasBatteryWindows() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
		`(Get-WmiObject -Class Win32_Battery | Measure-Object).Count`,
	).Output()
	if err != nil {
		return false
	}
	count := strings.TrimSpace(string(out))
	return count != "" && count != "0"
}

// collectAvStatus derives a single status string from the platform AV registry.
// Returns ("", "") on unsupported platforms or when the query times out.
func collectAvStatus() (status string, product string) {
	switch runtime.GOOS {
	case "windows":
		return collectAvWindows()
	case "linux":
		return collectAvLinux()
	}
	return "", ""
}

func collectAvWindows() (string, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	ps := `Get-WmiObject -Namespace root\SecurityCenter2 -Class AntiVirusProduct |` +
		` Select-Object displayName,productState | ConvertTo-Json -Compress`
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps,
	).Output()
	if err != nil {
		return "", ""
	}

	raw := strings.TrimSpace(string(out))
	if raw == "" || raw == "null" {
		return "not_detected", ""
	}

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
	if len(list) == 0 {
		return "not_detected", ""
	}

	// Worst-case wins: not_running > running_not_up_to_date > running_up_to_date
	bestStatus := "running_up_to_date"
	bestProduct := list[0].DisplayName
	for _, av := range list {
		enabled := ((av.ProductState >> 12) & 0xF) == 1
		upToDate := ((av.ProductState >> 4) & 0xF) == 0
		var s string
		switch {
		case !enabled:
			s = "not_running"
		case !upToDate:
			s = "running_not_up_to_date"
		default:
			s = "running_up_to_date"
		}
		if statusRank(s) > statusRank(bestStatus) {
			bestStatus = s
			bestProduct = av.DisplayName
		}
	}
	return bestStatus, bestProduct
}

func collectAvLinux() (string, string) {
	known := []struct{ bin, name string }{
		{"clamscan", "ClamAV"},
		{"sophos-av", "Sophos AV"},
		{"esetscan", "ESET NOD32"},
		{"symantec_antivirus", "Symantec AV"},
	}
	for _, av := range known {
		if _, err := exec.LookPath(av.bin); err == nil {
			// Presence detected; update status unknown on Linux
			return "running_not_up_to_date", av.name
		}
	}
	return "not_detected", ""
}

func statusRank(s string) int {
	switch s {
	case "not_running":
		return 3
	case "running_not_up_to_date":
		return 2
	case "running_up_to_date":
		return 1
	}
	return 0
}
