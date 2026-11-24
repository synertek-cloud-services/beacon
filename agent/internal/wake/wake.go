// Package wake keeps one WebSocket open to the worker's DeviceHub so the
// worker can tell this agent to check in right now (the "wake" text frame)
// instead of waiting out the poll interval. It carries no data: commands,
// sessions and jobs are still delivered by the ordinary check-in response, so
// a lost wake or a dropped socket only costs one poll interval.
//
// While the socket is up the main loop can poll slowly; while it is down
// (never connected, dropped, worker without a DeviceHub) the loop falls back
// to its normal 60s cadence, so behavior degrades to exactly what it was.
package wake

import (
	"context"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	pingInterval = 30 * time.Second
	// A missing pong for this long means the socket is dead (the 1006 drops
	// seen in soak tests leave it looking open to the client otherwise).
	readTimeout    = pingInterval + 15*time.Second
	minBackoff     = 2 * time.Second
	maxBackoff     = 5 * time.Minute
	stableAfter    = time.Minute // a connection this old resets the backoff
	handshakeLimit = 15 * time.Second
)

// Hub is the agent side of the wake channel.
type Hub struct {
	connected atomic.Bool
}

// Connected reports whether the wake socket is currently up.
func (h *Hub) Connected() bool { return h.connected.Load() }

// Start maintains the connection until stop is closed, calling onWake for each
// "wake" frame. The server URL is the same http(s) base used for check-in.
func Start(serverURL, credential string, onWake func(), stop <-chan struct{}) *Hub {
	h := &Hub{}
	go h.run(wsURL(serverURL), credential, onWake, stop)
	return h
}

func wsURL(serverURL string) string {
	u := strings.TrimRight(serverURL, "/") + "/v1/agent/ws"
	switch {
	case strings.HasPrefix(u, "https://"):
		return "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		return "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u
}

func (h *Hub) run(url, credential string, onWake func(), stop <-chan struct{}) {
	backoff := minBackoff
	for {
		started := time.Now()
		err := h.session(url, credential, onWake, stop)
		h.connected.Store(false)
		select {
		case <-stop:
			return
		default:
		}
		if time.Since(started) >= stableAfter {
			backoff = minBackoff
		}
		// Quiet at the steady state: a drop every half hour is normal.
		log.Printf("wake: disconnected (%v); retrying in %s", err, backoff)
		sleep := backoff/2 + time.Duration(rand.Int63n(int64(backoff)))
		select {
		case <-time.After(sleep):
		case <-stop:
			return
		}
		if backoff *= 2; backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (h *Hub) session(url, credential string, onWake func(), stop <-chan struct{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), handshakeLimit)
	defer cancel()
	dialer := websocket.Dialer{HandshakeTimeout: handshakeLimit}
	conn, _, err := dialer.DialContext(ctx, url, http.Header{"Authorization": {"Bearer " + credential}})
	if err != nil {
		return err
	}
	defer conn.Close()
	h.connected.Store(true)

	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(pingInterval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				if conn.WriteMessage(websocket.TextMessage, []byte("ping")) != nil {
					conn.Close()
					return
				}
			case <-done:
				return
			case <-stop:
				conn.Close()
				return
			}
		}
	}()

	for {
		conn.SetReadDeadline(time.Now().Add(readTimeout))
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		if string(msg) == "wake" {
			onWake()
		}
	}
}
