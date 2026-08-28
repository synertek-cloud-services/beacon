//go:build !windows

package traypipe

import (
	"context"
	"errors"
	"net"
)

// PipeName has no meaning off Windows -- the tray/pipe workflow is
// Windows-only, same "return a clear stub" convention this codebase already
// uses for other Windows-only paths (e.g. usersession's _other.go stubs).
const PipeName = ""

var errUnsupported = errors.New("traypipe: named pipes are Windows-only")

func Listen() (net.Listener, error) {
	return nil, errUnsupported
}

func Dial(ctx context.Context) (net.Conn, error) {
	return nil, errUnsupported
}
