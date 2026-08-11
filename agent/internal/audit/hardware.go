package audit

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"runtime"
	"strconv"
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

	hw.Architecture = runtime.GOARCH

	// CPU
	if cpus, err := collectCPU(); err == nil {
		hw.CPU = cpus
	}

	// RAM
	if vmem, err := mem.VirtualMemory(); err == nil {
		hw.RAM = protocol.RAMInfo{TotalBytes: vmem.Total}
	}
	hw.RAM.InstalledBytes = collectInstalledRAM()

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

	// System (manufacturer/model/motherboard)
	hw.System = collectSystemInfo()

	// Virtualization platform — checked independently of System/BIOS above
	// since WSL2 in particular reports none of those DMI/SMBIOS fields at all.
	hw.Virtualization = detectVirtualization()

	// Display adapters
	hw.DisplayAdapters = collectDisplayAdapters()

	// Windows-only: domain membership, feature-update display version,
	// install type (Client/Server) — no equivalent concept on Linux/macOS.
	if runtime.GOOS == "windows" {
		hw.Domain, hw.WindowsDisplayVersion, hw.WindowsInstallationType = collectWindowsInfo()
	}

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

func collectSystemInfo() *protocol.SystemInfo {
	switch runtime.GOOS {
	case "linux":
		return collectSystemInfoLinux()
	case "windows":
		return collectSystemInfoWindows()
	case "darwin":
		return collectSystemInfoDarwin()
	}
	return nil
}

func collectSystemInfoLinux() *protocol.SystemInfo {
	read := func(name string) string {
		b, err := os.ReadFile("/sys/class/dmi/id/" + name)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	// Unlike product_serial, these DMI fields are world-readable on most
	// distros — no root requirement here.
	vendor := read("sys_vendor")
	model := read("product_name")
	boardVendor := read("board_vendor")
	boardModel := read("board_name")
	if vendor == "" && model == "" && boardVendor == "" && boardModel == "" {
		return nil
	}
	return &protocol.SystemInfo{
		Manufacturer:      vendor,
		Model:             model,
		MotherboardVendor: boardVendor,
		MotherboardModel:  boardModel,
	}
}

func detectVirtualization() string {
	switch runtime.GOOS {
	case "linux":
		return detectVirtualizationLinux()
	case "windows":
		return detectVirtualizationWindows()
	case "darwin":
		return detectVirtualizationDarwin()
	}
	return ""
}

func detectVirtualizationLinux() string {
	// WSL has its own characteristic kernel release string — checked first
	// because WSL2 also reports Hyper-V-style DMI fields below, which would
	// otherwise misreport it as a plain Hyper-V VM instead of WSL specifically.
	if release, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		r := strings.ToLower(string(release))
		if strings.Contains(r, "wsl2") {
			return "WSL2"
		}
		if strings.Contains(r, "microsoft") || strings.Contains(r, "wsl") {
			return "WSL"
		}
	}

	read := func(name string) string {
		b, err := os.ReadFile("/sys/class/dmi/id/" + name)
		if err != nil {
			return ""
		}
		return strings.ToLower(strings.TrimSpace(string(b)))
	}
	vendor := read("sys_vendor")
	product := read("product_name")

	switch {
	case strings.Contains(vendor, "microsoft") && strings.Contains(product, "virtual machine"):
		return "Hyper-V"
	case strings.Contains(vendor, "vmware") || strings.Contains(product, "vmware"):
		return "VMware"
	case strings.Contains(vendor, "innotek") || strings.Contains(product, "virtualbox"):
		return "VirtualBox"
	case strings.Contains(product, "kvm") || strings.Contains(vendor, "qemu"):
		return "KVM/QEMU"
	}
	if _, err := os.Stat("/sys/hypervisor/type"); err == nil {
		return "Xen"
	}
	return ""
}

func detectVirtualizationWindows() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`Get-WmiObject Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress`,
	).Output()
	if err != nil {
		return ""
	}
	var v struct {
		Manufacturer string `json:"Manufacturer"`
		Model        string `json:"Model"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return ""
	}
	manufacturer := strings.ToLower(v.Manufacturer)
	model := strings.ToLower(v.Model)

	switch {
	case strings.Contains(manufacturer, "microsoft") && strings.Contains(model, "virtual machine"):
		return "Hyper-V"
	case strings.Contains(manufacturer, "vmware"):
		return "VMware"
	case strings.Contains(manufacturer, "innotek") || strings.Contains(model, "virtualbox"):
		return "VirtualBox"
	case strings.Contains(model, "kvm"):
		return "KVM"
	}
	return ""
}

// detectVirtualizationDarwin checks the Apple Virtualization Framework's guest
// flag — covers Parallels/VMware Fusion/UTM/Apple's own VMs on Apple Silicon
// and recent Intel Macs. Absent on real hardware, so any error means bare metal.
func detectVirtualizationDarwin() string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sysctl", "-n", "kern.hv_vmm_present").Output()
	if err != nil {
		return ""
	}
	if strings.TrimSpace(string(out)) == "1" {
		return "Virtual Machine"
	}
	return ""
}

func collectSystemInfoWindows() *protocol.SystemInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`$cs = Get-WmiObject Win32_ComputerSystem | Select-Object Manufacturer,Model; `+
			`$bb = Get-WmiObject Win32_BaseBoard | Select-Object Manufacturer,Product; `+
			`[PSCustomObject]@{ SysVendor=$cs.Manufacturer; SysModel=$cs.Model; BoardVendor=$bb.Manufacturer; BoardModel=$bb.Product } | ConvertTo-Json -Compress`,
	).Output()
	if err != nil {
		return nil
	}
	var v struct {
		SysVendor   string `json:"SysVendor"`
		SysModel    string `json:"SysModel"`
		BoardVendor string `json:"BoardVendor"`
		BoardModel  string `json:"BoardModel"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil
	}
	return &protocol.SystemInfo{
		Manufacturer:      strings.TrimSpace(v.SysVendor),
		Model:             strings.TrimSpace(v.SysModel),
		MotherboardVendor: strings.TrimSpace(v.BoardVendor),
		MotherboardModel:  strings.TrimSpace(v.BoardModel),
	}
}

func collectSystemInfoDarwin() *protocol.SystemInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "system_profiler", "SPHardwareDataType").Output()
	if err != nil {
		return nil
	}
	var model string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Model Name:") {
			model = strings.TrimSpace(strings.TrimPrefix(line, "Model Name:"))
		}
	}
	if model == "" {
		return nil
	}
	// No separate motherboard concept to report — Macs are unibody.
	return &protocol.SystemInfo{Manufacturer: "Apple", Model: model}
}

// collectDisplayAdapters reports installed GPU/video adapter names.
func collectDisplayAdapters() []string {
	switch runtime.GOOS {
	case "linux":
		return collectDisplayAdaptersLinux()
	case "windows":
		return collectDisplayAdaptersWindows()
	case "darwin":
		return collectDisplayAdaptersDarwin()
	}
	return nil
}

func collectDisplayAdaptersLinux() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "lspci").Output()
	if err != nil {
		return nil
	}
	var adapters []string
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, "VGA compatible controller") &&
			!strings.Contains(line, "3D controller") &&
			!strings.Contains(line, "Display controller") {
			continue
		}
		if idx := strings.Index(line, ": "); idx != -1 {
			adapters = append(adapters, strings.TrimSpace(line[idx+2:]))
		}
	}
	return adapters
}

func collectDisplayAdaptersWindows() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	// Wrapped in a single PSCustomObject so ConvertTo-Json can't collapse a
	// one-element (or zero-element) result back to a bare scalar/omitted
	// property the way it would for a top-level piped array.
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`$names = @(Get-WmiObject Win32_VideoController | ForEach-Object { $_.Name }); `+
			`[PSCustomObject]@{ Names = $names } | ConvertTo-Json -Compress`,
	).Output()
	if err != nil {
		return nil
	}
	var v struct {
		Names []string `json:"Names"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil
	}
	return v.Names
}

func collectDisplayAdaptersDarwin() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "system_profiler", "SPDisplaysDataType").Output()
	if err != nil {
		return nil
	}
	var adapters []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Chipset Model:") {
			adapters = append(adapters, strings.TrimSpace(strings.TrimPrefix(line, "Chipset Model:")))
		}
	}
	return adapters
}

// collectInstalledRAM reports raw physical DIMM capacity, distinct from the
// OS-visible/usable figure gopsutil's mem.VirtualMemory() already provides.
func collectInstalledRAM() uint64 {
	switch runtime.GOOS {
	case "linux":
		return collectInstalledRAMLinux()
	case "windows":
		return collectInstalledRAMWindows()
	case "darwin":
		return collectInstalledRAMDarwin()
	}
	return 0
}

func collectInstalledRAMLinux() uint64 {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	// dmidecode reads /dev/mem — root-only, same permission gotcha as the
	// BIOS serial number. Silently 0 when unreadable.
	out, err := exec.CommandContext(ctx, "dmidecode", "--type", "17").Output()
	if err != nil {
		return 0
	}
	var total uint64
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Size:") {
			continue
		}
		val := strings.TrimSpace(strings.TrimPrefix(line, "Size:"))
		if val == "No Module Installed" || val == "Unknown" {
			continue
		}
		parts := strings.Fields(val)
		if len(parts) != 2 {
			continue
		}
		n, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			continue
		}
		switch strings.ToUpper(parts[1]) {
		case "GB":
			total += uint64(n * 1e9)
		case "MB":
			total += uint64(n * 1e6)
		}
	}
	return total
}

func collectInstalledRAMWindows() uint64 {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`(Get-WmiObject Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum`,
	).Output()
	if err != nil {
		return 0
	}
	n, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func collectInstalledRAMDarwin() uint64 {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "system_profiler", "SPHardwareDataType").Output()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Memory:") {
			continue
		}
		parts := strings.Fields(strings.TrimSpace(strings.TrimPrefix(line, "Memory:")))
		if len(parts) != 2 {
			continue
		}
		n, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			continue
		}
		switch strings.ToUpper(parts[1]) {
		case "TB":
			return uint64(n * 1e12)
		case "GB":
			return uint64(n * 1e9)
		case "MB":
			return uint64(n * 1e6)
		}
	}
	return 0
}

// collectWindowsInfo reports domain membership, the feature-update display
// version (e.g. "24H2"), and install type (e.g. "Client"/"Server") — all
// Windows-only concepts with no honest Linux/macOS analog.
func collectWindowsInfo() (domain, displayVersion, installationType string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command",
		`$cs = Get-WmiObject Win32_ComputerSystem | Select-Object Domain,PartOfDomain; `+
			`$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'; `+
			// DisplayVersion (e.g. "24H2") replaced the older ReleaseId value
			// around Windows 10 20H2 — fall back for pre-20H2 hosts.
			`$dv = (Get-ItemProperty -Path $key -Name DisplayVersion -ErrorAction SilentlyContinue).DisplayVersion; `+
			`if (-not $dv) { $dv = (Get-ItemProperty -Path $key -Name ReleaseId -ErrorAction SilentlyContinue).ReleaseId }; `+
			`$it = (Get-ItemProperty -Path $key -Name InstallationType -ErrorAction SilentlyContinue).InstallationType; `+
			// Win32_ComputerSystem.Domain returns the *workgroup* name when
			// not domain-joined — only report it when PartOfDomain is true,
			// so a workgroup name never gets shown as if it were a domain.
			`[PSCustomObject]@{ Domain = $(if ($cs.PartOfDomain) { $cs.Domain } else { '' }); DisplayVersion = $dv; InstallationType = $it } | ConvertTo-Json -Compress`,
	).Output()
	if err != nil {
		return "", "", ""
	}
	var v struct {
		Domain           string `json:"Domain"`
		DisplayVersion   string `json:"DisplayVersion"`
		InstallationType string `json:"InstallationType"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return "", "", ""
	}
	return strings.TrimSpace(v.Domain), strings.TrimSpace(v.DisplayVersion), strings.TrimSpace(v.InstallationType)
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
