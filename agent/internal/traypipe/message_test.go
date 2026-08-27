package traypipe

import (
	"encoding/json"
	"net"
	"testing"
)

// TestConnRoundTrip exercises every message type over a net.Pipe() pair --
// an in-memory, full-duplex net.Conn pair from the standard library, which
// fits Conn's net.Conn-shaped API directly (no real OS pipe/syscall
// involved), so this runs on any host including this dev environment's
// Linux machine even though the real implementation is Windows-only.
func TestConnRoundTrip(t *testing.T) {
	cases := []struct {
		name    string
		msgType string
		payload any
	}{
		{"hello", TypeHello, HelloPayload{SessionID: 1, PID: 4321}},
		{"version_info", TypeVersionInfo, VersionInfoPayload{Version: "0.2.46", SupportURL: "https://example.com/support"}},
		{"version_info_empty", TypeVersionInfo, VersionInfoPayload{Version: "0.2.46"}},
		{"reboot_prompt", TypeRebootPrompt, RebootPromptPayload{}},
		{"reboot_response_yes", TypeRebootResponse, RebootResponsePayload{Confirmed: true}},
		{"reboot_response_no", TypeRebootResponse, RebootResponsePayload{Confirmed: false}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			serverSide, clientSide := net.Pipe()
			defer serverSide.Close()
			defer clientSide.Close()

			server := NewConn(serverSide)
			client := NewConn(clientSide)

			done := make(chan error, 1)
			go func() { done <- server.Send(tc.msgType, tc.payload) }()

			got, err := client.Recv()
			if err != nil {
				t.Fatalf("Recv: %v", err)
			}
			if err := <-done; err != nil {
				t.Fatalf("Send: %v", err)
			}
			if got.Type != tc.msgType {
				t.Fatalf("Type = %q, want %q", got.Type, tc.msgType)
			}

			wantPayload, err := json.Marshal(tc.payload)
			if err != nil {
				t.Fatalf("marshal expected payload: %v", err)
			}
			if string(got.Payload) != string(wantPayload) {
				t.Fatalf("Payload = %s, want %s", got.Payload, wantPayload)
			}
		})
	}
}

// TestReadMessage_Malformed proves Recv reports a clean error for bad input
// rather than panicking or hanging, for the cases a live pipe reader could
// actually see: a truncated write and an unrecognized message type (which
// must still decode cleanly -- unknown types are a dispatch-time concern for
// the caller, not a framing error).
func TestReadMessage_Malformed(t *testing.T) {
	t.Run("truncated_no_newline", func(t *testing.T) {
		serverSide, clientSide := net.Pipe()
		defer serverSide.Close()
		defer clientSide.Close()

		go func() {
			serverSide.Write([]byte(`{"type":"hello"`))
			serverSide.Close() // EOF before the delimiter ever arrives
		}()

		client := NewConn(clientSide)
		if _, err := client.Recv(); err == nil {
			t.Fatal("expected an error reading a truncated, unterminated message, got nil")
		}
	})

	t.Run("unknown_type_still_decodes", func(t *testing.T) {
		serverSide, clientSide := net.Pipe()
		defer serverSide.Close()
		defer clientSide.Close()

		go func() {
			serverSide.Write([]byte(`{"type":"something_new","payload":{}}` + "\n"))
		}()

		client := NewConn(clientSide)
		got, err := client.Recv()
		if err != nil {
			t.Fatalf("Recv of an unrecognized-but-well-formed type should not error: %v", err)
		}
		if got.Type != "something_new" {
			t.Fatalf("Type = %q, want %q", got.Type, "something_new")
		}
	})

	t.Run("invalid_json", func(t *testing.T) {
		serverSide, clientSide := net.Pipe()
		defer serverSide.Close()
		defer clientSide.Close()

		go func() {
			serverSide.Write([]byte(`not json at all` + "\n"))
		}()

		client := NewConn(clientSide)
		if _, err := client.Recv(); err == nil {
			t.Fatal("expected an error reading invalid JSON, got nil")
		}
	})
}
