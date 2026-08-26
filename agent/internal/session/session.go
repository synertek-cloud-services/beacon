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
	// every other session type. Needs no accompanying credentials: it
	// relaunches the helper with the agent service's own SYSTEM token, not
	// an Administrator token obtained from the logged-in user.
	Elevated bool `json:"elevated,omitempty"`
	// TargetSessionID picks which Windows Terminal Services session a
	// screen_share helper launches into -- the console session (nil, the
	// default and today's only behavior) or a specific RDS/AVD session a
	// technician picked from a Server-class device's session list (see
	// worker/src/routes/sessions.ts). A pointer, not a bare uint32, so an
	// absent field (every caller that predates this option) is
	// distinguishable from a literal session 0, which is a real, reserved
	// session ID (Services), never a valid target.
	TargetSessionID *uint32 `json:"target_session_id,omitempty"`
	// ReportToken authenticates beacon-screenshare.exe's own report of its
	// enumerated monitors back to the worker (POST .../displays) --
	// screen_share only, generated fresh per session by
	// worker/src/routes/sessions.ts. Never the device's own long-lived
	// credential, deliberately: this process runs inside the less-trusted
	// interactive user's session, not the SYSTEM-context agent.
	ReportToken string `json:"report_token,omitempty"`
	// Monitor picks which display beacon-screenshare.exe captures --
	// empty (the default) means the primary monitor, exactly today's only
	// behavior; a non-empty value is a specific monitor's real GDI device
	// name (e.g. `\\.\DISPLAY2`, as returned by win32.EnumMonitors and
	// reported via ReportToken above), chosen from WebRemotePage.vue's
	// Displays switcher.
	Monitor string `json:"monitor,omitempty"`
	// RequireConsent means the end user must Accept/Decline before
	// beacon-screenshare.exe connects -- screen_share only, resolved
	// worker-side from the company/device consent policy (issue #86). See
	// screenshare.go's runScreenShare for what the helper does with it.
	RequireConsent bool `json:"require_consent,omitempty"`
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
		runScreenShare(p.SessionID, p.WSURL, p.Elevated, p.TargetSessionID, p.ReportToken, p.Monitor, p.RequireConsent)
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
