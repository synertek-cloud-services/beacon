package inventory

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
)

type Snapshot struct {
	Hostname      string
	OSType        string
	OSVersion     string
	UptimeSeconds int64
	DiskFreeBytes int64
	DetectedClass string
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

	return &Snapshot{
		Hostname:      info.Hostname,
		OSType:        runtime.GOOS,
		OSVersion:     fmt.Sprintf("%s %s", info.Platform, info.PlatformVersion),
		UptimeSeconds: int64(info.Uptime),
		DiskFreeBytes: int64(du.Free),
		DetectedClass: detectClass(info),
	}, nil
}

func detectClass(info *host.InfoStat) string {
	switch runtime.GOOS {
	case "windows":
		// Rough heuristic — WMI Win32_SystemEnclosure/Win32_Battery comes in a later phase
		if strings.Contains(strings.ToLower(info.Platform), "server") ||
			strings.Contains(strings.ToLower(info.PlatformVersion), "server") {
			return "server"
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
