package audit

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	psnet "github.com/shirou/gopsutil/v3/net"

	"github.com/synertek-cloud-services/beacon/agent/internal/diskutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

func collectHardware() (*protocol.HardwareInfo, error) {
	hw := &protocol.HardwareInfo{}

	// CPU
	if cpus, err := collectCPU(); err == nil {
		hw.CPU = cpus
	}

	// RAM
	if vmem, err := mem.VirtualMemory(); err == nil {
		hw.RAM = protocol.RAMInfo{TotalBytes: vmem.Total}
	}

	// Disks
	if disks, err := diskutil.CollectDisks(); err == nil {
		hw.Disks = disks
	}

	// Network
	if nics, err := collectNetwork(); err == nil {
		hw.Network = nics
	}

	// BIOS
	hw.BIOS = collectBIOS()

	// Last logged-in user
	hw.LastLoggedInUser = collectLastLoggedInUser()

	return hw, nil
}

func collectCPU() ([]protocol.CPUInfo, error) {
	infos, err := cpu.Info()
	if err != nil || len(infos) == 0 {
		return nil, err
	}
	physicalCount, _ := cpu.Counts(false)
	return []protocol.CPUInfo{{
		Model:    infos[0].ModelName,
		Cores:    int32(physicalCount),
		SpeedMHz: infos[0].Mhz,
	}}, nil
}

func collectNetwork() ([]protocol.NetworkInfo, error) {
	ifaces, err := psnet.Interfaces()
	if err != nil {
		return nil, err
	}
	var nics []protocol.NetworkInfo
	for _, iface := range ifaces {
		if iface.HardwareAddr == "" {
			continue // skip loopback and virtual interfaces with no MAC
		}
		var addrs []string
		for _, a := range iface.Addrs {
			addrs = append(addrs, a.Addr)
		}
		nics = append(nics, protocol.NetworkInfo{
			Name:         iface.Name,
			HardwareAddr: iface.HardwareAddr,
			Addrs:        addrs,
		})
	}
	return nics, nil
}

func collectBIOS() *protocol.BIOSInfo {
	switch runtime.GOOS {
	case "linux":
		return collectBIOSLinux()
	case "windows":
		return collectBIOSWindows()
	case "darwin":
		return collectBIOSDarwin()
	}
	return nil
}

func collectBIOSLinux() *protocol.BIOSInfo {
	read := func(name string) string {
		b, err := os.ReadFile("/sys/class/dmi/id/" + name)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	vendor := read("bios_vendor")
	version := read("bios_version")
	date := read("bios_date")
	// product_serial is root-only (0400) on most distros — empty when the
	// agent isn't running as root, same silent-omission behavior as any
	// other unreadable field here.
	serial := read("product_serial")
	if vendor == "" && version == "" {
		return nil
	}
	return &protocol.BIOSInfo{Vendor: vendor, Version: version, ReleaseDate: date, SerialNumber: serial}
}

func collectBIOSWindows() *protocol.BIOSInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`Get-WmiObject Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate,SerialNumber | ConvertTo-Json -Compress`,
	).Output()
	if err != nil {
		return nil
	}
	var v struct {
		Manufacturer      string `json:"Manufacturer"`
		SMBIOSBIOSVersion string `json:"SMBIOSBIOSVersion"`
		ReleaseDate       string `json:"ReleaseDate"`
		SerialNumber      string `json:"SerialNumber"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil
	}
	return &protocol.BIOSInfo{
		Vendor:       strings.TrimSpace(v.Manufacturer),
		Version:      strings.TrimSpace(v.SMBIOSBIOSVersion),
		ReleaseDate:  strings.TrimSpace(v.ReleaseDate),
		SerialNumber: strings.TrimSpace(v.SerialNumber),
	}
}

func collectBIOSDarwin() *protocol.BIOSInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "system_profiler", "SPHardwareDataType").Output()
	if err != nil {
		return nil
	}
	var version, serial string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Boot ROM Version:") {
			version = strings.TrimSpace(strings.TrimPrefix(line, "Boot ROM Version:"))
		}
		if strings.HasPrefix(line, "Serial Number (system):") {
			serial = strings.TrimSpace(strings.TrimPrefix(line, "Serial Number (system):"))
		}
	}
	if version == "" && serial == "" {
		return nil
	}
	return &protocol.BIOSInfo{Vendor: "Apple", Version: version, SerialNumber: serial}
}

// collectLastLoggedInUser reports the current/most-recent interactive
// session's username. gopsutil's host.Users() reads utmp and works on
// Linux/Darwin but is explicitly unimplemented on Windows, so Windows goes
// through WMI instead — same shell-out convention as the BIOS collectors.
func collectLastLoggedInUser() string {
	if runtime.GOOS == "windows" {
		return collectLastLoggedInUserWindows()
	}
	users, err := host.Users()
	if err != nil || len(users) == 0 {
		return ""
	}
	latest := users[0]
	for _, u := range users[1:] {
		if u.Started > latest.Started {
			latest = u
		}
	}
	return latest.User
}

func collectLastLoggedInUserWindows() string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`(Get-CimInstance -ClassName Win32_ComputerSystem).UserName`,
	).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
