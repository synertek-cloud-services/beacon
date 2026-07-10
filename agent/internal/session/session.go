package session

import (
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
	"github.com/synertekcs/beacon/agent/internal/protocol"
)

type openPayload struct {
	SessionID   string `json:"session_id"`
	SessionType string `json:"session_type"`
	WSURL       string `json:"ws_url"`
	TCPPort     int    `json:"tcp_port,omitempty"`
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
