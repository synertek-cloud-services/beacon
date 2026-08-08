//go:build windows

// beacon-screenshare is a standalone, Windows-only helper launched into a
// logged-in user's own desktop session by the SYSTEM-context agent service
// (via agent/internal/usersession.RunAsActiveUser -- see
// agent/internal/session/screenshare.go), one process per Web Remote
// session. It dials the relay WebSocket directly (never the main agent
// process) and runs a minimal RFB server against the real GDI screen
// capture and SendInput injection backends, so the whole capture+injection
// loop happens natively inside the target session with no window-station
// tricks needed.
//
// Usage: beacon-screenshare.exe --session-id=<id> --ws-url=<wss://...>
package main

import (
	"flag"
	"log"

	"github.com/gorilla/websocket"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/screencapture"
	"github.com/synertek-cloud-services/beacon/agent/internal/screeninject"
)

func main() {
	sessionID := flag.String("session-id", "", "Beacon session ID")
	wsURL := flag.String("ws-url", "", "relay WebSocket URL")
	flag.Parse()

	if *wsURL == "" {
		log.Fatal("beacon-screenshare: --ws-url is required")
	}

	conn, _, err := websocket.DefaultDialer.Dial(*wsURL, nil)
	if err != nil {
		log.Fatalf("beacon-screenshare: session %s: dial: %v", *sessionID, err)
	}
	defer conn.Close()

	cap, err := screencapture.NewGDICapturer()
	if err != nil {
		log.Fatalf("beacon-screenshare: session %s: capturer: %v", *sessionID, err)
	}
	width, height := cap.Size()
	inj := screeninject.New(width, height)

	if err := rfbserver.Serve(newWSByteStream(conn), cap, inj); err != nil {
		log.Printf("beacon-screenshare: session %s: %v", *sessionID, err)
	}
}

// wsByteStream adapts a *websocket.Conn into an io.ReadWriter, buffering
// leftover bytes between ReadMessage calls -- unlike shell.go's unbounded
// PTY byte stream, noVNC can and does batch multiple RFB client messages
// into one outgoing WebSocket frame (e.g. SetPixelFormat+SetEncodings+the
// first FramebufferUpdateRequest arrive together right after ServerInit).
// A naive one-ReadMessage-per-Read adapter would silently drop everything
// in a batched frame after the first message.
type wsByteStream struct {
	conn *websocket.Conn
	buf  []byte
}

func newWSByteStream(conn *websocket.Conn) *wsByteStream {
	return &wsByteStream{conn: conn}
}

func (s *wsByteStream) Read(p []byte) (int, error) {
	for len(s.buf) == 0 {
		mt, data, err := s.conn.ReadMessage()
		if err != nil {
			return 0, err
		}
		if mt == websocket.BinaryMessage {
			s.buf = data
		}
		// Non-binary frames (e.g. a stray text/control frame) are
		// silently skipped -- RFB has no legitimate use for one here.
	}
	n := copy(p, s.buf)
	s.buf = s.buf[n:]
	return n, nil
}

func (s *wsByteStream) Write(p []byte) (int, error) {
	if err := s.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}
