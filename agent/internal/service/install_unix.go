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
)

const (
	linuxBinPath  = "/usr/local/bin/beacon-agent"
	linuxUnitPath = "/etc/systemd/system/beacon-agent.service"
	macBinPath    = "/usr/local/bin/beacon-agent"
	macPlistPath  = "/Library/LaunchDaemons/com.beacon.agent.plist"
	macPlistLabel = "com.beacon.agent"
)

func Install(serverURL, enrollToken string) error {
	switch runtime.GOOS {
	case "linux":
		return installLinux(serverURL, enrollToken)
	case "darwin":
		return installDarwin(serverURL, enrollToken)
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

const linuxUnitTmpl = `[Unit]
Description=Beacon RMM Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={{.Bin}} --server-url {{.ServerURL}} --enroll-token {{.Token}}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
`

func installLinux(serverURL, enrollToken string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	if err := copyFile(exe, linuxBinPath); err != nil {
		return fmt.Errorf("copy binary: %w", err)
	}

	unit, err := render(linuxUnitTmpl, map[string]string{
		"Bin": linuxBinPath, "ServerURL": serverURL, "Token": enrollToken,
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
		<string>--enroll-token</string><string>{{.Token}}</string>
	</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>/var/log/beacon-agent.log</string>
	<key>StandardErrorPath</key><string>/var/log/beacon-agent.log</string>
</dict>
</plist>
`

func installDarwin(serverURL, enrollToken string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	if err := copyFile(exe, macBinPath); err != nil {
		return fmt.Errorf("copy binary: %w", err)
	}

	plist, err := render(macPlistTmpl, map[string]string{
		"Label": macPlistLabel, "Bin": macBinPath,
		"ServerURL": serverURL, "Token": enrollToken,
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
