//go:build !windows

package session

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixPTY struct {
	f   *os.File
	cmd *exec.Cmd
}

func (p *unixPTY) Read(b []byte) (int, error)  { return p.f.Read(b) }
func (p *unixPTY) Write(b []byte) (int, error) { return p.f.Write(b) }

func (p *unixPTY) Resize(cols, rows int) error {
	return pty.Setsize(p.f, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (p *unixPTY) Close() error {
	err := p.f.Close()
	_ = p.cmd.Process.Kill()
	go p.cmd.Wait() //nolint:errcheck // reap in background, don't block Close
	return err
}

func startPTY(shellCmd string) (ptySession, error) {
	cmd := exec.Command(shellCmd)
	f, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixPTY{f: f, cmd: cmd}, nil
}

// defaultShell picks $SHELL if set, falling back to bash then sh — mirrors
// how an interactive terminal session would normally be spawned.
func defaultShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	if _, err := os.Stat("/bin/bash"); err == nil {
		return "/bin/bash"
	}
	return "/bin/sh"
}
