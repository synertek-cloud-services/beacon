package wake

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestWsURL(t *testing.T) {
	cases := map[string]string{
		"https://api.example.com": "wss://api.example.com/v1/agent/ws",
		"http://localhost:8787/":  "ws://localhost:8787/v1/agent/ws",
	}
	for in, want := range cases {
		if got := wsURL(in); got != want {
			t.Errorf("wsURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWakeDeliveredAndConnectedFlag(t *testing.T) {
	up := websocket.Upgrader{}
	gotAuth := make(chan string, 1)
	push := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth <- r.Header.Get("Authorization")
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		<-push
		c.WriteMessage(websocket.TextMessage, []byte("wake"))
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()

	woke := make(chan struct{}, 1)
	stop := make(chan struct{})
	defer close(stop)
	h := Start(strings.Replace(srv.URL, "http", "http", 1), "cred123", func() { woke <- struct{}{} }, stop)

	if a := <-gotAuth; a != "Bearer cred123" {
		t.Fatalf("auth header = %q", a)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !h.Connected() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !h.Connected() {
		t.Fatal("never reported connected")
	}
	close(push)
	select {
	case <-woke:
	case <-time.After(2 * time.Second):
		t.Fatal("wake not delivered")
	}
	// Server closes shortly after; connected must drop.
	deadline = time.Now().Add(3 * time.Second)
	for h.Connected() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if h.Connected() {
		t.Fatal("still connected after server close")
	}
}
