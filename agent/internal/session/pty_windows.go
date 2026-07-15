//go:build windows

package session

import (
	"github.com/UserExistsError/conpty"
)

type windowsPTY struct {
	cpty *conpty.ConPty
}

func (p *windowsPTY) Read(b []byte) (int, error)  { return p.cpty.Read(b) }
func (p *windowsPTY) Write(b []byte) (int, error) { return p.cpty.Write(b) }
func (p *windowsPTY) Resize(cols, rows int) error { return p.cpty.Resize(cols, rows) }
func (p *windowsPTY) Close() error                { return p.cpty.Close() }

func startPTY(shellCmd string) (ptySession, error) {
	cpty, err := conpty.Start(shellCmd)
	if err != nil {
		return nil, err
	}
	return &windowsPTY{cpty: cpty}, nil
}

// defaultShell — PowerShell is the RMM-standard default on Windows, matching
// this codebase's existing "shell: auto" component convention.
func defaultShell() string {
	return "powershell.exe"
}
