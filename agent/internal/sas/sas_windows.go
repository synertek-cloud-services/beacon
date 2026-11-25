//go:build windows

// Package sas lets a Web Remote session send Ctrl+Alt+Delete (the secure
// attention sequence) to the console. Windows ignores synthesized Ctrl+Alt+Del
// keystrokes by design; the only way to raise it from software is the
// sas.dll SendSAS API, and Windows only honors that when the
// SoftwareSASGeneration policy allows it. SendSAS(false) must be called from
// the agent service (session 0, SYSTEM), so the screenshare helper -- which
// runs in the target session -- asks the service over a small local pipe.
package sas

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// PipeName is the SYSTEM/Administrators-only pipe the service listens on.
const PipeName = `\\.\pipe\BeaconAgentSAS`

// pipeSDDL allows only SYSTEM and Administrators: the Web Remote helper that
// needs Ctrl+Alt+Del runs as SYSTEM at the sign-in screen. An ordinary user's
// own helper can't use it, and no unprivileged process can make the service
// change a Windows policy.
const pipeSDDL = "D:(A;;GA;;;SY)(A;;GA;;;BA)"

const (
	policyKey   = `SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`
	policyValue = "SoftwareSASGeneration"

	statusOK       = 0
	statusFailed   = 1
	statusBadSessn = 2
)

var (
	sasDLL      = windows.NewLazySystemDLL("sas.dll")
	procSendSAS = sasDLL.NewProc("SendSAS")

	serverMu      sync.Mutex
	serverStarted bool
)

// ensurePolicy makes sure Windows will accept SendSAS from a service. Unset or
// 0 becomes 1 (services); 2 (Ease of Access apps only) becomes 3 (both). A
// value that already allows services, whether we or a Group Policy set it, is
// left alone. Applied only at the moment Ctrl+Alt+Del is first requested, so
// devices that never use the button are never touched.
func ensurePolicy() (changed bool, err error) {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, policyKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return false, fmt.Errorf("sas: open policy key: %w", err)
	}
	defer k.Close()

	cur, _, err := k.GetIntegerValue(policyValue)
	if err != nil && err != registry.ErrNotExist {
		return false, fmt.Errorf("sas: read %s: %w", policyValue, err)
	}
	var want uint32
	switch cur {
	case 1, 3:
		return false, nil
	case 2:
		want = 3
	default:
		want = 1
	}
	if err := k.SetDWordValue(policyValue, want); err != nil {
		return false, fmt.Errorf("sas: set %s=%d: %w", policyValue, want, err)
	}
	return true, nil
}

func sendSAS() error {
	if err := procSendSAS.Find(); err != nil {
		return fmt.Errorf("sas: sas.dll: %w", err)
	}
	procSendSAS.Call(0) // AsUser=FALSE: the caller is a service
	return nil
}

// StartServer starts the pipe listener inside the agent service if it isn't
// already running. Retryable like the tray pipe server: a failure just means
// it is attempted again on the next call.
func StartServer() {
	serverMu.Lock()
	defer serverMu.Unlock()
	if serverStarted {
		return
	}
	ln, err := winio.ListenPipe(PipeName, &winio.PipeConfig{SecurityDescriptor: pipeSDDL})
	if err != nil {
		log.Printf("sas: pipe listen: %v (will retry)", err)
		return
	}
	serverStarted = true
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				log.Printf("sas: pipe accept: %v", err)
				serverMu.Lock()
				serverStarted = false
				serverMu.Unlock()
				return
			}
			go handle(conn)
		}
	}()
}

func handle(conn io.ReadWriteCloser) {
	defer conn.Close()
	var buf [4]byte
	if _, err := io.ReadFull(bufio.NewReader(conn), buf[:]); err != nil {
		return
	}
	session := binary.LittleEndian.Uint32(buf[:])

	// SendSAS(false) is delivered to the console session. Refuse anything
	// else rather than raise Ctrl+Alt+Del on a different session than the
	// technician is looking at.
	if console := windows.WTSGetActiveConsoleSessionId(); session != console {
		log.Printf("sas: request from session %d ignored (console is session %d)", session, console)
		conn.Write([]byte{statusBadSessn})
		return
	}
	changed, err := ensurePolicy()
	if err != nil {
		log.Printf("sas: %v", err)
		conn.Write([]byte{statusFailed})
		return
	}
	if changed {
		log.Printf("sas: enabled %s so Web Remote can send Ctrl+Alt+Delete", policyValue)
	}
	if err := sendSAS(); err != nil {
		log.Printf("sas: %v", err)
		conn.Write([]byte{statusFailed})
		return
	}
	conn.Write([]byte{statusOK})
}

// Request asks the agent service to send Ctrl+Alt+Delete on behalf of the
// calling process's own session.
func Request() error {
	var session uint32
	if err := windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &session); err != nil {
		return fmt.Errorf("sas: own session: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := winio.DialPipeContext(ctx, PipeName)
	if err != nil {
		return fmt.Errorf("sas: reach agent service: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	var buf [4]byte
	binary.LittleEndian.PutUint32(buf[:], session)
	if _, err := conn.Write(buf[:]); err != nil {
		return fmt.Errorf("sas: send request: %w", err)
	}
	var reply [1]byte
	if _, err := io.ReadFull(conn, reply[:]); err != nil {
		return fmt.Errorf("sas: read reply: %w", err)
	}
	switch reply[0] {
	case statusOK:
		return nil
	case statusBadSessn:
		return fmt.Errorf("sas: Ctrl+Alt+Delete is only supported on the console session")
	default:
		return fmt.Errorf("sas: the agent service could not send it (see agent.log)")
	}
}
