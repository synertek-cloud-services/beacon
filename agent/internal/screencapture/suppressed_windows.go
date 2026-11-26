//go:build windows

package screencapture

import (
	"errors"

	"golang.org/x/sys/windows"

	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
)

// errDisplaySuppressed is returned while the session's display isn't being
// rendered: an RDP session whose client window is minimized (or whose client
// is gone) has output suppressed, and Windows refuses screen access for it.
var errDisplaySuppressed = errors.New("screencapture: the session's display is not being rendered (RDP client minimized or disconnected)")

// displaySuppressed reports whether Windows is currently refusing screen
// access for this session. Measured on an RDP session: a 1x1 BitBlt from the
// screen DC fails with ERROR_INVALID_HANDLE exactly while the client window is
// minimized and succeeds as soon as it is visible again -- even on a virtual
// display where whole-screen GDI capture never works. That makes it a cheap,
// reliable signal, unlike DXGI Desktop Duplication, which in that state can
// sit forever returning "no new frame" without an error and never recover.
//
// Deliberately conservative: only that one specific failure counts. Any other
// problem (GetDC or bitmap creation failing, a different BitBlt error) reports
// false, so this can never block capture on a healthy session.
func displaySuppressed() bool {
	sdc, err := win32.GetDC(0)
	if err != nil {
		return false
	}
	defer win32.ReleaseDC(0, sdc)
	mem, err := win32.CreateCompatibleDC(sdc)
	if err != nil {
		return false
	}
	defer win32.DeleteDC(mem)
	bmp, err := win32.CreateCompatibleBitmap(sdc, 1, 1)
	if err != nil {
		return false
	}
	defer win32.DeleteObject(win32.HGDIOBJ(bmp))
	old, err := win32.SelectObject(mem, win32.HGDIOBJ(bmp))
	if err != nil {
		return false
	}
	defer win32.SelectObject(mem, old)

	return errors.Is(win32.BitBlt(mem, 0, 0, 1, 1, sdc, 0, 0, win32.SRCCOPY), windows.ERROR_INVALID_HANDLE)
}
