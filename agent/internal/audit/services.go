package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/synertekcs/beacon/agent/internal/protocol"
)

func collectServices() ([]protocol.ServiceItem, error) {
	switch runtime.GOOS {
	case "linux":
		return collectServicesLinux()
	case "windows":
		return collectServicesWindows()
	case "darwin":
		return collectServicesDarwin()
	}
	return nil, nil
}

func collectServicesLinux() ([]protocol.ServiceItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// List all units and their active/sub state
	unitsOut, err := exec.CommandContext(ctx,
		"systemctl", "list-units", "--type=service", "--all",
		"--no-pager", "--no-legend",
	).Output()
	if err != nil {
		return nil, err
	}

	type unitState struct{ active, sub string }
	byName := map[string]unitState{}

	scanner := bufio.NewScanner(strings.NewReader(string(unitsOut)))
	for scanner.Scan() {
		line := scanner.Text()
		// Strip leading status symbol (● ○ etc.) and whitespace
		line = strings.TrimLeft(line, " ●○✗")
		line = strings.TrimSpace(line)
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := strings.TrimSuffix(fields[0], ".service")
		byName[name] = unitState{active: fields[2], sub: fields[3]}
	}

	// List unit files to get enabled/disabled state
	filesOut, err := exec.CommandContext(ctx,
		"systemctl", "list-unit-files", "--type=service",
		"--no-pager", "--no-legend",
	).Output()
	if err == nil {
		scanner2 := bufio.NewScanner(strings.NewReader(string(filesOut)))
		for scanner2.Scan() {
			fields := strings.Fields(strings.TrimSpace(scanner2.Text()))
			if len(fields) < 2 {
				continue
			}
			name := strings.TrimSuffix(fields[0], ".service")
			if s, ok := byName[name]; ok {
				s.active = s.active // state already known
				byName[name] = s
			} else {
				// Unit file exists but no running instance — add it
				byName[name] = unitState{active: "inactive", sub: "dead"}
			}
		}
	}

	var services []protocol.ServiceItem
	for name, state := range byName {
		if name == "" {
			continue
		}
		status := "stopped"
		if state.sub == "running" {
			status = "running"
		}
		services = append(services, protocol.ServiceItem{
			Name:        name,
			DisplayName: name,
			Status:      status,
		})
	}
	return services, nil
}

func collectServicesWindows() ([]protocol.ServiceItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ps := `@(Get-Service | Select-Object Name,DisplayName,Status,StartType) | ConvertTo-Json -Compress`
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", ps,
	).Output()
	if err != nil {
		return nil, err
	}

	raw := strings.TrimSpace(string(out))
	if raw == "" || raw == "null" {
		return nil, nil
	}

	type psService struct {
		Name        string `json:"Name"`
		DisplayName string `json:"DisplayName"`
		Status      int    `json:"Status"`      // ServiceControllerStatus enum value
		StartType   int    `json:"StartType"`   // ServiceStartMode enum value
	}

	var svcList []psService
	if raw[0] == '[' {
		if err := json.Unmarshal([]byte(raw), &svcList); err != nil {
			return nil, err
		}
	} else {
		var single psService
		if err := json.Unmarshal([]byte(raw), &single); err != nil {
			return nil, err
		}
		svcList = []psService{single}
	}

	// ServiceControllerStatus: 1=Stopped, 4=Running, 7=Paused
	// ServiceStartMode: 0=Boot, 1=System, 2=Automatic, 3=Manual, 4=Disabled
	startTypeStr := map[int]string{0: "boot", 1: "system", 2: "automatic", 3: "manual", 4: "disabled"}

	var services []protocol.ServiceItem
	for _, s := range svcList {
		status := "stopped"
		if s.Status == 4 {
			status = "running"
		}
		startType := startTypeStr[s.StartType]
		if startType == "" {
			startType = "unknown"
		}
		services = append(services, protocol.ServiceItem{
			Name:        s.Name,
			DisplayName: s.DisplayName,
			Status:      status,
			StartType:   startType,
		})
	}
	return services, nil
}

func collectServicesDarwin() ([]protocol.ServiceItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "launchctl", "list").Output()
	if err != nil {
		return nil, err
	}

	var services []protocol.ServiceItem
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	// Skip header line: "PID\tStatus\tLabel"
	scanner.Scan()
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		pid := fields[0]
		label := fields[2]
		status := "stopped"
		if pid != "-" && pid != "0" {
			status = "running"
		}
		services = append(services, protocol.ServiceItem{
			Name:        label,
			DisplayName: label,
			Status:      status,
		})
	}
	return services, nil
}
