//go:build !windows

package service

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"text/template"

	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
)

const (
	linuxBinPath  = "/usr/local/bin/beacon-agent"
	linuxUnitPath = "/etc/systemd/system/beacon-agent.service"
	macBinPath    = "/usr/local/bin/beacon-agent"
	macPlistPath  = "/Library/LaunchDaemons/com.beacon.agent.plist"
	macPlistLabel = "com.beacon.agent"
)

func Install(serverURL string) error {
	switch runtime.GOOS {
	case "linux":
		return installLinux(serverURL)
	case "darwin":
		return installDarwin(serverURL)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func Uninstall() error {
	switch runtime.GOOS {
	case "linux":
		return uninstallLinux()
	case "darwin":
		return uninstallDarwin()
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// SelfUninstall is called by the agent's own running process in response to
// a remotely-dispatched uninstall_agent command -- unlike Uninstall() above
// (invoked by a separate `beacon-agent uninstall` process), this must not
// call systemctl stop/launchctl unload synchronously from within the very
// process being stopped: both block until the unit actually exits, and
// since neither this process nor Go installs a custom SIGTERM handler, the
// OS's default SIGTERM action (immediate termination) fires the moment the
// stop takes effect -- killing this process mid-call, before disable/remove
// ever run. The Linux helper must additionally leave beacon-agent.service's
// cgroup: a plain detached child is still killed by systemd when the main
// process exits. A transient systemd unit provides that cgroup boundary.
func SelfUninstall() error {
	switch runtime.GOOS {
	case "linux":
		// credential.Dir()'s rm -rf also removes agent.log (setupLogging
		// writes it into the same directory as credential.json on every
		// platform, not just Windows) -- neither was ever removed by any
		// uninstall path before, which left a stale credential behind for a
		// later reinstall to silently reuse instead of enrolling fresh.
		script := fmt.Sprintf(
			"sleep 2; systemctl stop beacon-agent; systemctl disable beacon-agent; rm -f %s %s; rm -rf %s; systemctl daemon-reload",
			linuxUnitPath, linuxBinPath, credential.Dir(),
		)
		// --no-block makes Run wait only for systemd to accept the transient
		// unit, not for the cleanup itself. Run (rather than Start) confirms
		// submission before the caller exits and also reaps systemd-run.
		if err := linuxSelfUninstallCommand(os.Getpid(), script).Run(); err != nil {
			return fmt.Errorf("submit uninstall helper: %w", err)
		}
		return nil
	case "darwin":
		script := fmt.Sprintf(
			"sleep 2; launchctl unload %s; rm -f %s %s; rm -rf %s",
			macPlistPath, macPlistPath, macBinPath, credential.Dir(),
		)
		// launchd does not place an ordinary detached child in the daemon's
		// lifecycle the way systemd's service cgroup does on Linux.
		if err := exec.Command("sh", "-c", script).Start(); err != nil {
			return fmt.Errorf("spawn uninstall helper: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func linuxSelfUninstallCommand(pid int, script string) *exec.Cmd {
	return exec.Command(
		"systemd-run",
		fmt.Sprintf("--unit=beacon-agent-uninstall-%d", pid),
		"--collect",
		"--no-block",
		"/bin/sh",
		"-c",
		script,
	)
}

// Reharden is a no-op on Linux/macOS -- their restart-on-exit behavior
// (systemd's Restart=always, launchd's KeepAlive) is written directly
// into the unit/plist file at install time, not configured via a separate
// runtime API call the way Windows' SCM recovery actions are, so there's no
// equivalent gap to self-heal here. See install_windows.go's Reharden.
func Reharden() {}

const linuxUnitTmpl = `[Unit]
Description=Beacon RMM Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={{.Bin}} --server-url {{.ServerURL}}
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
`

func installLinux(serverURL string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	if err := copyFile(exe, linuxBinPath); err != nil {
		return fmt.Errorf("copy binary: %w", err)
	}

	unit, err := render(linuxUnitTmpl, map[string]string{
		"Bin": linuxBinPath, "ServerURL": serverURL,
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(linuxUnitPath, unit, 0o644); err != nil {
		return fmt.Errorf("write unit file: %w", err)
	}

	run("systemctl", "daemon-reload")
	run("systemctl", "enable", "beacon-agent")
	if err := run("systemctl", "start", "beacon-agent"); err != nil {
		return fmt.Errorf("start service: %w", err)
	}
	fmt.Println("Beacon agent installed and started as systemd service beacon-agent.")
	return nil
}

func uninstallLinux() error {
	run("systemctl", "stop", "beacon-agent")
	run("systemctl", "disable", "beacon-agent")
	os.Remove(linuxUnitPath)
	run("systemctl", "daemon-reload")
	os.Remove(linuxBinPath)
	// See SelfUninstall's Linux branch comment -- credential.json/agent.log
	// were never removed by any uninstall path before this.
	os.RemoveAll(credential.Dir())
	fmt.Println("Beacon agent removed.")
	return nil
}

const macPlistTmpl = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>{{.Label}}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{{.Bin}}</string>
		<string>--server-url</string><string>{{.ServerURL}}</string>
	</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>/var/log/beacon-agent.log</string>
	<key>StandardErrorPath</key><string>/var/log/beacon-agent.log</string>
</dict>
</plist>
`

func installDarwin(serverURL string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	if err := copyFile(exe, macBinPath); err != nil {
		return fmt.Errorf("copy binary: %w", err)
	}

	plist, err := render(macPlistTmpl, map[string]string{
		"Label": macPlistLabel, "Bin": macBinPath, "ServerURL": serverURL,
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(macPlistPath, plist, 0o644); err != nil {
		return fmt.Errorf("write plist: %w", err)
	}

	run("launchctl", "unload", macPlistPath)
	if err := run("launchctl", "load", macPlistPath); err != nil {
		return fmt.Errorf("load service: %w", err)
	}
	fmt.Println("Beacon agent installed and started as LaunchDaemon com.beacon.agent.")
	return nil
}

func uninstallDarwin() error {
	run("launchctl", "unload", macPlistPath)
	os.Remove(macPlistPath)
	os.Remove(macBinPath)
	// See SelfUninstall's Darwin branch comment -- credential.json/agent.log
	// were never removed by any uninstall path before this.
	os.RemoveAll(credential.Dir())
	fmt.Println("Beacon agent removed.")
	return nil
}

func render(tmpl string, data map[string]string) ([]byte, error) {
	t, err := template.New("").Parse(tmpl)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func run(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}
