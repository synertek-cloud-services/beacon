package session

import (
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
)

// ptySession abstracts the platform-specific PTY backend (pty_unix.go /
// pty_windows.go) so this file stays platform-agnostic.
type ptySession interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

type controlMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// runShell spawns a persistent PTY-backed shell process and streams it over
// the WebSocket for the lifetime of the connection: binary frames carry raw
// PTY bytes in both directions (keystrokes in, combined stdout/stderr out —
// a PTY interleaves them naturally, unlike the old buffer-per-stream
// approach), text frames carry a small JSON control envelope (currently just
// resize). Runs until the WebSocket closes, at which point the PTY-backed
// process is killed — never left running on the endpoint.
func runShell(conn *websocket.Conn, sessionID string) {
	pty, err := startPTY(defaultShell())
	if err != nil {
		log.Printf("session %s: pty start: %v", sessionID, err)
		return
	}
	defer pty.Close()

	go pumpPTYOutput(conn, pty, sessionID)

	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			return // client disconnected or session closed
		}
		switch mt {
		case websocket.BinaryMessage:
			if _, err := pty.Write(msg); err != nil {
				return
			}
		case websocket.TextMessage:
			var ctl controlMsg
			if json.Unmarshal(msg, &ctl) == nil && ctl.Type == "resize" && ctl.Cols > 0 && ctl.Rows > 0 {
				_ = pty.Resize(ctl.Cols, ctl.Rows)
			}
		}
	}
}

func pumpPTYOutput(conn *websocket.Conn, pty ptySession, sessionID string) {
	buf := make([]byte, 4096)
	for {
		n, err := pty.Read(buf)
		if n > 0 {
			if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			log.Printf("session %s: pty closed: %v", sessionID, err)
			conn.Close() //nolint:errcheck // unblocks the read loop in runShell above
			return
		}
	}
}
