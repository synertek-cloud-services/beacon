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
	"github.com/shirou/gopsutil/v3/mem"
	psnet "github.com/shirou/gopsutil/v3/net"

	"github.com/synertekcs/beacon/agent/internal/diskutil"
	"github.com/synertekcs/beacon/agent/internal/protocol"
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
	if vendor == "" && version == "" {
		return nil
	}
	return &protocol.BIOSInfo{Vendor: vendor, Version: version, ReleaseDate: date}
}

func collectBIOSWindows() *protocol.BIOSInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`Get-WmiObject Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate | ConvertTo-Json -Compress`,
	).Output()
	if err != nil {
		return nil
	}
	var v struct {
		Manufacturer     string `json:"Manufacturer"`
		SMBIOSBIOSVersion string `json:"SMBIOSBIOSVersion"`
		ReleaseDate      string `json:"ReleaseDate"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil
	}
	return &protocol.BIOSInfo{
		Vendor:      strings.TrimSpace(v.Manufacturer),
		Version:     strings.TrimSpace(v.SMBIOSBIOSVersion),
		ReleaseDate: strings.TrimSpace(v.ReleaseDate),
	}
}

func collectBIOSDarwin() *protocol.BIOSInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "system_profiler", "SPHardwareDataType").Output()
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Boot ROM Version:") {
			version := strings.TrimSpace(strings.TrimPrefix(line, "Boot ROM Version:"))
			return &protocol.BIOSInfo{Vendor: "Apple", Version: version}
		}
	}
	return nil
}
