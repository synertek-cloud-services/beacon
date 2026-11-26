//go:build windows

package session

import (
	"context"
	"sync"

	"github.com/UserExistsError/conpty"
)

// windowsPTY wraps a ConPTY. Unlike a Unix PTY, a ConPTY's output pipe does not
// reach EOF when the shell process exits -- reads just keep blocking until the
// pseudo console is closed. Without the exit watcher below, typing `exit` in a
// remote shell left the session open on a dead terminal until the technician
// closed it by hand (found on a Windows 11 VM; the Linux backend closes on
// its own because reading a dead pty errors).
type windowsPTY struct {
	cpty        *conpty.ConPty
	cancel      context.CancelFunc
	watcherDone chan struct{}
	once        sync.Once
	closeErr    error
}

func (p *windowsPTY) Read(b []byte) (int, error)  { return p.cpty.Read(b) }
func (p *windowsPTY) Write(b []byte) (int, error) { return p.cpty.Write(b) }
func (p *windowsPTY) Resize(cols, rows int) error { return p.cpty.Resize(cols, rows) }

// Close is safe to call more than once and from any goroutine: ConPty.Close
// closes raw handles, so a second call must never reach it.
func (p *windowsPTY) Close() error {
	p.once.Do(func() {
		p.cancel()
		<-p.watcherDone // the watcher must be out of WaitForSingleObject before the handles go
		p.closeErr = p.cpty.Close()
	})
	return p.closeErr
}

func startPTY(shellCmd string) (ptySession, error) {
	cpty, err := conpty.Start(shellCmd)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &windowsPTY{cpty: cpty, cancel: cancel, watcherDone: make(chan struct{})}
	go func() {
		_, _ = cpty.Wait(ctx)
		exited := ctx.Err() == nil // not canceled by Close, so the shell itself ended
		close(p.watcherDone)
		if exited {
			// Closing the pseudo console makes the output pump's Read fail,
			// which in turn closes the WebSocket and ends the session.
			_ = p.Close()
		}
	}()
	return p, nil
}

// defaultShell — PowerShell is the RMM-standard default on Windows, matching
// this codebase's existing "shell: auto" component convention.
func defaultShell() string {
	return "powershell.exe"
}
