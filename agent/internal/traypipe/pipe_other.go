//go:build !windows

package traypipe

import (
	"context"
	"errors"
	"net"
)

// PipeName has no meaning off Windows -- the tray/pipe workflow is
// Windows-only, matching agent/internal/rebootmarker's own equivalent stub.
const PipeName = ""

var errUnsupported = errors.New("traypipe: named pipes are Windows-only")

func Listen() (net.Listener, error) {
	return nil, errUnsupported
}

func Dial(ctx context.Context) (net.Conn, error) {
	return nil, errUnsupported
}
