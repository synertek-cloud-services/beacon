package session

import (
	"fmt"
	"log"
	"net"

	"github.com/gorilla/websocket"
)

// runTunnel forwards raw bytes between the WebSocket relay and a local TCP port.
// Used for Secure RDP: the operator's machine connects to the DO client WebSocket,
// the agent connects to localhost:3389, and the DO relays bytes between them.
func runTunnel(conn *websocket.Conn, sessionID string, port int) {
	addr := fmt.Sprintf("localhost:%d", port)
	tcp, err := net.Dial("tcp", addr)
	if err != nil {
		log.Printf("session %s: tcp dial %s: %v", sessionID, addr, err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(1011, "tcp connect failed"))
		return
	}
	defer tcp.Close()

	done := make(chan struct{}, 1)

	// WebSocket → TCP
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			_, b, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if _, err := tcp.Write(b); err != nil {
				return
			}
		}
	}()

	// TCP → WebSocket
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 32*1024)
		for {
			n, err := tcp.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(1000, "tcp closed"))
				return
			}
		}
	}()

	<-done // wait for either side to stop
}
