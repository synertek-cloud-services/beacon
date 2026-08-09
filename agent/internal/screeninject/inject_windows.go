//go:build windows

// Package screeninject implements agent/internal/rfbserver.Injector via
// Win32 SendInput -- Windows-only, matching Web Remote's v1 scope. Cannot
// be exercised in a non-Windows development sandbox; cross-compile-checked
// only until confirmed on real Windows hardware.
package screeninject

import (
	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
	"github.com/synertek-cloud-services/beacon/agent/internal/x11keysym"
)

var _ rfbserver.Injector = (*Injector)(nil)

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
// sequentially from its own single message loop, so none is needed.
type Injector struct {
	screenW, screenH uint16
	lastMask         uint8
}

// New creates an Injector whose absolute pointer coordinates are
// normalized against screenW/screenH -- these must match the same
// DPI-aware dimensions screencapture.GDICapturer.Size() reports, or clicks
// land on the wrong pixel on any scaled display.
func New(screenW, screenH uint16) *Injector {
	return &Injector{screenW: screenW, screenH: screenH}
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
func (i *Injector) PointerEvent(mask uint8, x, y uint16) error {
	absX, absY := i.normalize(x, y)

	if err := win32.SendMouseInput(absX, absY, 0, win32.MouseEventFMove|win32.MouseEventFAbsolute); err != nil {
		return err
	}

	changed := mask ^ i.lastMask
	if changed&buttonLeft != 0 {
		flag := uint32(win32.MouseEventFLeftUp)
		if mask&buttonLeft != 0 {
			flag = win32.MouseEventFLeftDown
		}
		if err := win32.SendMouseInput(absX, absY, 0, flag|win32.MouseEventFAbsolute); err != nil {
			return err
		}
	}
	if changed&buttonMiddle != 0 {
		flag := uint32(win32.MouseEventFMiddleUp)
		if mask&buttonMiddle != 0 {
			flag = win32.MouseEventFMiddleDown
		}
		if err := win32.SendMouseInput(absX, absY, 0, flag|win32.MouseEventFAbsolute); err != nil {
			return err
		}
	}
	if changed&buttonRight != 0 {
		flag := uint32(win32.MouseEventFRightUp)
		if mask&buttonRight != 0 {
			flag = win32.MouseEventFRightDown
		}
		if err := win32.SendMouseInput(absX, absY, 0, flag|win32.MouseEventFAbsolute); err != nil {
			return err
		}
	}

	// RFB has no dedicated scroll message -- the wheel is modeled as
	// button 4/5 "clicks" that arrive set-then-immediately-cleared, so
	// only the down edge (not up) synthesizes a MOUSEEVENTF_WHEEL tick.
	if mask&buttonWheelUp != 0 && i.lastMask&buttonWheelUp == 0 {
		if err := win32.SendMouseInput(absX, absY, uint32(win32.WheelDelta), win32.MouseEventFWheel|win32.MouseEventFAbsolute); err != nil {
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
		if err := win32.SendMouseInput(absX, absY, uint32(negDelta), win32.MouseEventFWheel|win32.MouseEventFAbsolute); err != nil {
			return err
		}
	}

	i.lastMask = mask
	return nil
}

// normalize converts framebuffer-pixel coordinates to SendInput's
// 0-65535 absolute coordinate space.
func (i *Injector) normalize(x, y uint16) (int32, int32) {
	var absX, absY int32
	if i.screenW > 0 {
		absX = int32(int64(x) * 65535 / int64(i.screenW))
	}
	if i.screenH > 0 {
		absY = int32(int64(y) * 65535 / int64(i.screenH))
	}
	return absX, absY
}
