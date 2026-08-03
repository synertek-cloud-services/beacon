//go:build !windows

package service

import (
	"reflect"
	"strings"
	"testing"
)

func TestLinuxUnitRestartsAfterCleanAgentExit(t *testing.T) {
	if !strings.Contains(linuxUnitTmpl, "Restart=always") {
		t.Fatal("Linux unit must restart after restart_agent exits cleanly")
	}
	if strings.Contains(linuxUnitTmpl, "Restart=on-failure") {
		t.Fatal("Restart=on-failure leaves the agent stopped after restart_agent")
	}
}

func TestLinuxSelfUninstallRunsOutsideAgentServiceCgroup(t *testing.T) {
	script := "cleanup-command"
	cmd := linuxSelfUninstallCommand(1234, script)
	want := []string{
		"systemd-run",
		"--unit=beacon-agent-uninstall-1234",
		"--collect",
		"--no-block",
		"/bin/sh",
		"-c",
		script,
	}
	if !reflect.DeepEqual(cmd.Args, want) {
		t.Fatalf("linux uninstall command = %#v, want %#v", cmd.Args, want)
	}
}
