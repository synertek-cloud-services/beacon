package session

import (
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

type openPayload struct {
	SessionID   string `json:"session_id"`
	SessionType string `json:"session_type"`
	WSURL       string `json:"ws_url"`
	TCPPort     int    `json:"tcp_port,omitempty"`
	// Elevated requests the "Elevate" on-demand escalation for screen_share
	// sessions only -- see screenshare.go's runScreenShare. Ignored by
	// every other session type.
	Elevated bool `json:"elevated,omitempty"`
}

// Handle connects to the session relay DO and dispatches to the correct handler.
// Runs until the session closes — call from a goroutine.
func Handle(cmd protocol.Command) {
	var p openPayload
	if err := json.Unmarshal(cmd.Payload, &p); err != nil {
		log.Printf("session: invalid payload: %v", err)
		return
	}

	log.Printf("session %s: opening %s session", p.SessionID, p.SessionType)

	// screen_share is special-cased before the dial below, not folded into
	// the switch as just another case: its actual relay connection is made
	// by a per-session helper process running inside the target user's own
	// desktop session (see screenshare.go), not by this SYSTEM-context
	// process. SessionRelay broadcasts to every peer socket sharing a
	// role, so if this process also dialed as role=agent for the same
	// session, two agent-role sockets would both receive the browser's
	// bytes and corrupt RFB's strict single-byte-stream protocol.
	if p.SessionType == "screen_share" {
		runScreenShare(p.SessionID, p.WSURL, p.Elevated)
		log.Printf("session %s: closed", p.SessionID)
		return
	}

	conn, _, err := websocket.DefaultDialer.Dial(p.WSURL, nil)
	if err != nil {
		log.Printf("session %s: dial: %v", p.SessionID, err)
		return
	}
	defer conn.Close()

	switch p.SessionType {
	case "shell":
		runShell(conn, p.SessionID)
	case "tcp_tunnel":
		runTunnel(conn, p.SessionID, p.TCPPort)
	default:
		log.Printf("session %s: unknown type %q", p.SessionID, p.SessionType)
	}

	log.Printf("session %s: closed", p.SessionID)
}
