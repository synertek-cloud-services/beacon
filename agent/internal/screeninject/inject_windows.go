//go:build windows

// Package screeninject implements agent/internal/rfbserver.Injector via
// Win32 SendInput -- Windows-only, matching Web Remote's v1 scope. Cannot
// be exercised in a non-Windows development sandbox; cross-compile-checked
// only until confirmed on real Windows hardware.
package screeninject

import (
	"fmt"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
	"github.com/synertek-cloud-services/beacon/agent/internal/x11keysym"
)

var _ rfbserver.Injector = (*Injector)(nil)
var _ rfbserver.DesktopFollower = (*Injector)(nil)

// RFB PointerEvent button-mask bits, RFC 6143 §7.5.5.
const (
	buttonLeft      = 1 << 0
	buttonMiddle    = 1 << 1
	buttonRight     = 1 << 2
	buttonWheelUp   = 1 << 3
	buttonWheelDown = 1 << 4
)

// Injector translates RFB input events into Win32 SendInput calls. Not
// safe for concurrent use -- rfbserver.Serve only ever calls it
// sequentially, from its own single dedicated injection goroutine, so
// none is needed.
type Injector struct {
	// monitorRect is this injector's target monitor, in virtual-desktop
	// coordinates -- incoming PointerEvent (x,y) are relative to this
	// rect's own top-left, matching what GDICapturer.Size() reports for
	// the same monitor.
	monitorRect win32.RECT
	// virtualLeft/virtualTop/virtualWidth/virtualHeight describe the full
	// virtual desktop (every monitor combined) -- SendInput's absolute
	// coordinate space is normalized against this extent, via
	// MOUSEEVENTF_VIRTUALDESK (see PointerEvent), not just the primary
	// monitor's own extent, so a click lands correctly regardless of
	// which monitor is being captured, including one positioned above or
	// left of the primary (genuinely negative virtual-desktop
	// coordinates).
	virtualLeft, virtualTop, virtualWidth, virtualHeight int32

	lastMask    uint8
	lastDesktop string
}

// New creates an Injector targeting the primary monitor -- a thin wrapper
// around NewForMonitor using the primary monitor's own well-known (0,0)
// origin (Windows' own invariant: the primary monitor's origin is always
// (0,0) in virtual-desktop coordinates), so every existing caller (which
// only ever captures the primary monitor today) keeps working unchanged.
// screenW/screenH must match the same DPI-aware dimensions
// screencapture.GDICapturer.Size() reports for the same monitor, or
// clicks land on the wrong pixel on any scaled display.
func New(screenW, screenH uint16) *Injector {
	return NewForMonitor(win32.RECT{Left: 0, Top: 0, Right: int32(screenW), Bottom: int32(screenH)})
}

// NewForMonitor creates an Injector targeting a specific monitor rect
// (virtual-desktop coordinates, as returned by win32.EnumMonitors).
func NewForMonitor(monitorRect win32.RECT) *Injector {
	return &Injector{
		monitorRect:   monitorRect,
		virtualLeft:   win32.GetSystemMetrics(win32.SM_XVIRTUALSCREEN),
		virtualTop:    win32.GetSystemMetrics(win32.SM_YVIRTUALSCREEN),
		virtualWidth:  win32.GetSystemMetrics(win32.SM_CXVIRTUALSCREEN),
		virtualHeight: win32.GetSystemMetrics(win32.SM_CYVIRTUALSCREEN),
	}
}

// KeyEvent injects a keyboard event. An X11 keysym with no known Windows
// virtual-key mapping is silently dropped, not treated as an error --
// x11keysym's table is deliberately non-exhaustive.
func (i *Injector) KeyEvent(down bool, keysym uint32) error {
	vk, ok := x11keysym.ToVirtualKey(keysym)
	if !ok {
		return nil
	}
	return win32.SendKeybdInput(vk, down)
}

// PointerEvent injects a mouse move plus any button/wheel transitions.
// RFB's PointerEvent carries an absolute button-mask snapshot on every
// call, not discrete down/up events, so transitions are detected by
// diffing against the mask from the previous call.
//
// Every SendMouseInput call ORs in win32.MouseEventFVirtualDesk alongside
// MouseEventFAbsolute -- normalizing against the full virtual desktop
// (SM_C/XVIRTUALSCREEN, see normalize) rather than just the primary
// monitor's own extent, applied uniformly rather than branched on which
// monitor is targeted. This is a strict superset of the old primary-only
// behavior: for a single-monitor system (or when targeting the primary
// monitor specifically), the virtual desktop and the primary monitor
// occupy the same origin and extent, so the normalized result is
// identical either way.
func (i *Injector) PointerEvent(mask uint8, x, y uint16) error {
	absX, absY := i.normalize(x, y)

	if err := win32.SendMouseInput(absX, absY, 0, win32.MouseEventFMove|win32.MouseEventFAbsolute|win32.MouseEventFVirtualDesk); err != nil {
		return err
	}

	changed := mask ^ i.lastMask
	if changed&buttonLeft != 0 {
		flag := uint32(win32.MouseEventFLeftUp)
		if mask&buttonLeft != 0 {
			flag = win32.MouseEventFLeftDown
		}
		if err := win32.SendMouseInput(absX, absY, 0, flag|win32.MouseEventFAbsolute|win32.MouseEventFVirtualDesk); err != nil {
			return err
		}
	}
	if changed&buttonMiddle != 0 {
		flag := uint32(win32.MouseEventFMiddleUp)
		if mask&buttonMiddle != 0 {
			flag = win32.MouseEventFMiddleDown
		}
		if err := win32.SendMouseInput(absX, absY, 0, flag|win32.MouseEventFAbsolute|win32.MouseEventFVirtualDesk); err != nil {
			return err
		}
	}
	if changed&buttonRight != 0 {
		flag := uint32(win32.MouseEventFRightUp)
		if mask&buttonRight != 0 {
			flag = win32.MouseEventFRightDown
		}
		if err := win32.SendMouseInput(absX, absY, 0, flag|win32.MouseEventFAbsolute|win32.MouseEventFVirtualDesk); err != nil {
			return err
		}
	}

	// RFB has no dedicated scroll message -- the wheel is modeled as
	// button 4/5 "clicks" that arrive set-then-immediately-cleared, so
	// only the down edge (not up) synthesizes a MOUSEEVENTF_WHEEL tick.
	if mask&buttonWheelUp != 0 && i.lastMask&buttonWheelUp == 0 {
		if err := win32.SendMouseInput(absX, absY, uint32(win32.WheelDelta), win32.MouseEventFWheel|win32.MouseEventFAbsolute|win32.MouseEventFVirtualDesk); err != nil {
			return err
		}
	}
	if mask&buttonWheelDown != 0 && i.lastMask&buttonWheelDown == 0 {
		// mouseData for MOUSEEVENTF_WHEEL is a signed 16-bit delta packed
		// into the field's low bits, reinterpreted as unsigned -- must go
		// through a variable, not a constant expression, since Go
		// disallows converting an out-of-range *constant* to an unsigned
		// type even though the runtime two's-complement reinterpretation
		// here is exactly what's wanted.
		negDelta := int32(-win32.WheelDelta)
		if err := win32.SendMouseInput(absX, absY, uint32(negDelta), win32.MouseEventFWheel|win32.MouseEventFAbsolute|win32.MouseEventFVirtualDesk); err != nil {
			return err
		}
	}

	i.lastMask = mask
	return nil
}

// FollowInputDesktop implements rfbserver.DesktopFollower -- see
// GDICapturer's own doc comment (agent/internal/screencapture) for the
// shared reasoning behind this mechanism. No mutex needed here, unlike
// GDICapturer's own version: an Injector is only ever called from
// rfbserver's one dedicated, already-serialized injection goroutine, so
// there is no equivalent of GDICapturer's rare timeout-leak concurrency
// window to guard against.
func (i *Injector) FollowInputDesktop() error {
	hDesk, err := win32.OpenInputDesktop()
	if err != nil {
		return fmt.Errorf("screeninject: open input desktop: %w", err)
	}
	defer win32.CloseDesktop(hDesk)

	name, err := win32.DesktopName(hDesk)
	if err != nil {
		return fmt.Errorf("screeninject: desktop name: %w", err)
	}
	if name == i.lastDesktop {
		return nil
	}
	if err := win32.SetThreadDesktop(hDesk); err != nil {
		return fmt.Errorf("screeninject: set thread desktop %q: %w", name, err)
	}
	i.lastDesktop = name
	return nil
}

// normalize converts framebuffer-pixel coordinates -- relative to this
// injector's own target monitor -- into SendInput's 0-65535 absolute
// coordinate space, normalized against the full virtual desktop (paired
// with MOUSEEVENTF_VIRTUALDESK in PointerEvent) rather than just this
// monitor's own extent. Two stages, not one: first convert the
// monitor-relative input into an absolute virtual-desktop pixel
// (monitorRect.Left/Top can themselves be negative, for a monitor
// positioned above/left of the primary), then scale that absolute pixel
// into the 0-65535 range using the virtual desktop's own origin and
// extent -- MOUSEEVENTF_VIRTUALDESK's documented contract, standard Win32
// technique but genuinely unexercised in this codebase until now (see
// win32.MouseEventFVirtualDesk's own doc comment for the same "needs
// real-hardware verification" flag).
func (i *Injector) normalize(x, y uint16) (int32, int32) {
	vdX := i.monitorRect.Left + int32(x)
	vdY := i.monitorRect.Top + int32(y)

	var absX, absY int32
	if i.virtualWidth > 0 {
		absX = int32(int64(vdX-i.virtualLeft) * 65535 / int64(i.virtualWidth))
	}
	if i.virtualHeight > 0 {
		absY = int32(int64(vdY-i.virtualTop) * 65535 / int64(i.virtualHeight))
	}
	return absX, absY
}
