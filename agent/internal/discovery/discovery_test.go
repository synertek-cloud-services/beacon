package discovery

import (
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"net"
	"testing"

	"golang.org/x/crypto/ssh"
)

// Credentialed Network Discovery (issue #78) -- probeSSHAddr is verified
// here against a real, independent golang.org/x/crypto/ssh server (the
// same library minus roles, not a hand-rolled fake), listening on a real
// local unprivileged port. probeSNMPAddr's equivalent SNMP round trip was
// verified in this session against a real net-snmp `snmpd` instance rather
// than a permanent automated test -- gosnmp has no bundled server
// component to embed hermetically the way x/crypto/ssh does, and a
// permanent test depending on a real external `snmpd` process would break
// in any environment that doesn't have one installed.

// generateTestHostKey returns a throwaway RSA host key for the in-process
// test SSH server below -- generated fresh per test run, never persisted.
func generateTestHostKey(t *testing.T) ssh.Signer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test host key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatalf("ssh.NewSignerFromKey: %v", err)
	}
	return signer
}

// startTestSSHServer starts a real, minimal in-process SSH server that
// accepts exactly one password credential and answers any single "exec"
// request with fixed output -- enough to exercise probeSSHAddr's real
// client-side plumbing (handshake, password auth, session, CombinedOutput)
// against a genuinely independent implementation, with no real uname
// binary or shell needed server-side. Returns the port it's listening on;
// stops when the test ends.
func startTestSSHServer(t *testing.T, username, password, execOutput string) int {
	t.Helper()
	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == username && string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("password rejected for %q", c.User())
		},
	}
	config.AddHostKey(generateTestHostKey(t))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { listener.Close() })

	go func() {
		for {
			nConn, err := listener.Accept()
			if err != nil {
				return // listener closed -- test ending
			}
			go handleTestSSHConn(nConn, config, execOutput)
		}
	}()

	return listener.Addr().(*net.TCPAddr).Port
}

func handleTestSSHConn(nConn net.Conn, config *ssh.ServerConfig, execOutput string) {
	conn, chans, reqs, err := ssh.NewServerConn(nConn, config)
	if err != nil {
		return // failed handshake/auth -- expected for the wrong-password test case
	}
	defer conn.Close()
	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			return
		}
		go func() {
			for req := range requests {
				if req.Type != "exec" {
					req.Reply(false, nil)
					continue
				}
				req.Reply(true, nil)
				channel.Write([]byte(execOutput))
				channel.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
				channel.Close()
			}
		}()
	}
}

func TestProbeSSHAddrSuccess(t *testing.T) {
	port := startTestSSHServer(t, "testuser", "testpass", "Linux testhost 5.15.0 x86_64\n")

	open, banner, osInfo, ok := probeSSHAddr("127.0.0.1", port, "testuser", "testpass")
	if !open {
		t.Fatal("expected open=true -- the real TCP dial should have succeeded")
	}
	if !ok {
		t.Fatal("expected ok=true -- a correct password should authenticate")
	}
	if banner == "" {
		t.Fatal("expected a non-empty banner from a real SSH server handshake")
	}
	if osInfo != "Linux testhost 5.15.0 x86_64" {
		t.Fatalf("osInfo = %q, want the fixed test server output (trimmed)", osInfo)
	}
}

func TestProbeSSHAddrWrongPassword(t *testing.T) {
	port := startTestSSHServer(t, "testuser", "testpass", "unused")

	open, _, _, ok := probeSSHAddr("127.0.0.1", port, "testuser", "wrongpass")
	if !open {
		t.Fatal("expected open=true -- the TCP port genuinely is open, only auth should fail")
	}
	if ok {
		t.Fatal("expected ok=false for a wrong password")
	}
}

func TestProbeSSHAddrClosedPort(t *testing.T) {
	// A real closed port: listen then immediately close, so nothing is
	// bound there -- the OS refuses the connection immediately, the same
	// signal a real closed/filtered port on a discovered host produces.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	open, _, _, ok := probeSSHAddr("127.0.0.1", port, "testuser", "testpass")
	if open {
		t.Fatal("expected open=false for a closed port")
	}
	if ok {
		t.Fatal("expected ok=false for a closed port")
	}
}
