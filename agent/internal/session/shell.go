package session

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"runtime"

	"github.com/gorilla/websocket"
)

type shellInput struct {
	Input string `json:"input"`
}

type shellOutput struct {
	Stream string `json:"stream"` // "stdout" | "stderr" | "exit"
	Data   string `json:"data,omitempty"`
	Code   int    `json:"code,omitempty"`
	Done   bool   `json:"done"`
}

// runShell executes each incoming message as a shell command and streams output
// back. Runs until the WebSocket closes. Not a persistent shell process — each
// message is an independent invocation. PTY/interactive support is a future phase.
func runShell(conn *websocket.Conn, sessionID string) {
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return // client disconnected or session closed
		}

		var in shellInput
		if err := json.Unmarshal(msg, &in); err != nil {
			continue
		}

		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.Command("cmd", "/c", in.Input)
		} else {
			cmd = exec.Command("sh", "-c", in.Input)
		}

		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		runErr := cmd.Run()

		if stdout.Len() > 0 {
			send(conn, shellOutput{Stream: "stdout", Data: stdout.String()})
		}
		if stderr.Len() > 0 {
			send(conn, shellOutput{Stream: "stderr", Data: stderr.String()})
		}

		code := 0
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		}
		send(conn, shellOutput{Stream: "exit", Code: code, Done: true})
	}
}

func send(conn *websocket.Conn, out shellOutput) {
	data, _ := json.Marshal(out)
	conn.WriteMessage(websocket.TextMessage, data) //nolint:errcheck
}
