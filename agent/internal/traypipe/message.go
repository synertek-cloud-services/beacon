// Package traypipe is the shared message protocol for the local named-pipe
// channel between the SYSTEM-context agent service (server) and each
// per-session beacon-tray.exe (client). It replaces three previously
// separate, ad-hoc mechanisms -- launch-time-only CLI flags, a polled
// shared JSON file requiring a hand-granted filesystem ACL, and PID-number
// liveness tracking -- with one live, bidirectional connection per tray
// session. See agent/internal/service/tray_windows.go (server) and
// agent/cmd/beacon-tray/main.go (client) for the two ends of this.
package traypipe

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
)

// Message is the wire envelope for every value sent over the pipe in either
// direction. Deliberately mirrors protocol.Command's existing {Type,
// Payload} shape (agent/internal/protocol/types.go) rather than inventing a
// new convention -- Type selects how Payload is interpreted, and adding a
// new message kind never requires a framing change.
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Message types.
const (
	// TypeHello is always the first message a client sends after connecting,
	// identifying which session it's running in. The server drops any
	// connection whose first message isn't this.
	TypeHello = "hello"

	// TypeVersionInfo is sent by the server on connect and again whenever
	// the agent's version/support-URL/dashboard-URL state changes -- a live
	// push, closing the "eventually consistent, only picked up on next
	// relaunch" gap the old CLI-flag-only approach had.
	TypeVersionInfo = "version_info"

	// TypeRebootPrompt is sent by the server when a reboot is pending and
	// unconfirmed (on the connection that requested it arriving, on a fresh
	// connect if a prompt is already outstanding, and again whenever a
	// snooze expires). The client is expected to reply with
	// TypeRebootResponse once the user answers.
	TypeRebootPrompt = "reboot_prompt"

	// TypeRebootResponse is sent by the client with the user's answer to a
	// TypeRebootPrompt.
	TypeRebootResponse = "reboot_response"
)

// HelloPayload identifies the connecting tray client.
type HelloPayload struct {
	SessionID uint32 `json:"session_id"`
	// PID is informational/log-only -- the connection itself, not the PID,
	// is what the server treats as the liveness signal.
	PID uint32 `json:"pid"`
}

// VersionInfoPayload carries everything the tray's menu needs to render.
// All fields omitempty: an empty SupportURL/DashboardURL means "hide that
// menu item," matching today's launch-flag behavior. DashboardURL has no
// current source (the agent doesn't yet know the dashboard's own origin --
// see tray_windows.go's own doc comment) but is wired through end-to-end
// now so a future source needs no protocol change.
type VersionInfoPayload struct {
	Version      string `json:"version,omitempty"`
	SupportURL   string `json:"support_url,omitempty"`
	DashboardURL string `json:"dashboard_url,omitempty"`
}

// RebootPromptPayload is empty today -- kept as a real struct (not just an
// empty Payload) so a future field never forces a new message type.
type RebootPromptPayload struct{}

// RebootResponsePayload carries the user's answer only. Deliberately no
// client-supplied snooze timestamp -- the server computes and owns that
// policy decision itself, matching this codebase's standing "the agent
// always does the actual privileged/authoritative thing" convention.
type RebootResponsePayload struct {
	Confirmed bool `json:"confirmed"`
}

// WriteMessage encodes m as compact JSON followed by a single newline.
// Compact (non-indented) encoding never emits a raw newline byte inside the
// JSON itself, so '\n' is always a safe, unambiguous message delimiter.
func WriteMessage(w io.Writer, m Message) error {
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("traypipe: marshal message: %w", err)
	}
	data = append(data, '\n')
	_, err = w.Write(data)
	return err
}

// ReadMessage reads and decodes one newline-delimited Message. Uses
// bufio.Reader.ReadBytes rather than bufio.Scanner, which has a fixed
// (default 64KB) token-size cap -- not a real concern for these small
// payloads, but ReadBytes has no cap to reason about at all.
func ReadMessage(r *bufio.Reader) (Message, error) {
	line, err := r.ReadBytes('\n')
	if err != nil {
		return Message{}, err
	}
	var m Message
	if err := json.Unmarshal(line, &m); err != nil {
		return Message{}, fmt.Errorf("traypipe: unmarshal message: %w", err)
	}
	return m, nil
}

// Conn wraps a live pipe connection with the Send/Recv API both the
// server's per-connection goroutine and the client's read loop use, so the
// framing logic above is written -- and tested -- exactly once.
type Conn struct {
	w io.Writer
	r *bufio.Reader
	c io.Closer
}

// NewConn wraps rw (typically a net.Conn, which satisfies io.ReadWriteCloser)
// for framed Send/Recv use.
func NewConn(rw io.ReadWriteCloser) *Conn {
	return &Conn{w: rw, r: bufio.NewReader(rw), c: rw}
}

// Send marshals payload and writes it as a framed Message of the given type.
func (c *Conn) Send(msgType string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("traypipe: marshal %s payload: %w", msgType, err)
	}
	return WriteMessage(c.w, Message{Type: msgType, Payload: data})
}

// Recv reads and returns the next framed Message.
func (c *Conn) Recv() (Message, error) {
	return ReadMessage(c.r)
}

// Close closes the underlying connection.
func (c *Conn) Close() error {
	return c.c.Close()
}
