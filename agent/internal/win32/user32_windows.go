//go:build windows

package win32

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

type HWND uintptr
type HICON uintptr

const (
	SM_CXSCREEN = 0
	SM_CYSCREEN = 1

	// dpiAwarenessContextPerMonitorAwareV2 is the documented Win32
	// "pseudo-handle" constant DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
	// defined by Microsoft as ((DPI_AWARENESS_CONTEXT)-4) -- ^uintptr(3)
	// produces the identical bit pattern (0xFFFFFFFFFFFFFFFC on 64-bit)
	// without an intermediate signed-to-unsigned cast.
	dpiAwarenessContextPerMonitorAwareV2 = ^uintptr(3)

	cursorShowing = 0x00000001

	// SendInput input types.
	inputMouse    = 0
	inputKeyboard = 1

	// Keyboard flags.
	keyeventfKeyUp = 0x0002

	// Mouse flags.
	MouseEventFMove       = 0x0001
	MouseEventFLeftDown   = 0x0002
	MouseEventFLeftUp     = 0x0004
	MouseEventFRightDown  = 0x0008
	MouseEventFRightUp    = 0x0010
	MouseEventFMiddleDown = 0x0020
	MouseEventFMiddleUp   = 0x0040
	MouseEventFWheel      = 0x0800
	MouseEventFAbsolute   = 0x8000

	WheelDelta = 120
)

var (
	moduser32 = windows.NewLazySystemDLL("user32.dll")

	procGetDC                         = moduser32.NewProc("GetDC")
	procReleaseDC                     = moduser32.NewProc("ReleaseDC")
	procGetSystemMetrics              = moduser32.NewProc("GetSystemMetrics")
	procSendInput                     = moduser32.NewProc("SendInput")
	procGetCursorInfo                 = moduser32.NewProc("GetCursorInfo")
	procDrawIconEx                    = moduser32.NewProc("DrawIconEx")
	procSetProcessDpiAwarenessContext = moduser32.NewProc("SetProcessDpiAwarenessContext")
	procSetProcessDPIAware            = moduser32.NewProc("SetProcessDPIAware")
)

// GetDC returns a device context for hwnd (0 = the entire screen).
func GetDC(hwnd HWND) (HDC, error) {
	r1, _, err := procGetDC.Call(uintptr(hwnd))
	if r1 == 0 {
		return 0, fmt.Errorf("win32: GetDC: %w", err)
	}
	return HDC(r1), nil
}

// ReleaseDC releases a device context obtained from GetDC.
func ReleaseDC(hwnd HWND, hdc HDC) error {
	r1, _, _ := procReleaseDC.Call(uintptr(hwnd), uintptr(hdc))
	if r1 == 0 {
		return fmt.Errorf("win32: ReleaseDC: failed")
	}
	return nil
}

// GetSystemMetrics returns the requested system metric (e.g. SM_CXSCREEN).
func GetSystemMetrics(index int32) int32 {
	r1, _, _ := procGetSystemMetrics.Call(uintptr(index))
	return int32(r1)
}

// EnableDPIAwareness makes this process report real (not virtualized)
// screen dimensions and coordinates on a scaled display (125%/150%/200%,
// extremely common) -- must be called once at process startup, before any
// GetSystemMetrics/BitBlt/SendInput coordinate call, or capture size and
// SendInput's coordinate mapping will silently disagree with each other.
// Falls back to the older, coarser SetProcessDPIAware on Windows versions
// predating the 1703 per-monitor-v2 API.
func EnableDPIAwareness() error {
	r1, _, err := procSetProcessDpiAwarenessContext.Call(dpiAwarenessContextPerMonitorAwareV2)
	if r1 != 0 {
		return nil
	}
	r1, _, err2 := procSetProcessDPIAware.Call()
	if r1 == 0 {
		return fmt.Errorf("win32: DPI awareness: per-monitor-v2 failed (%v), fallback failed (%v)", err, err2)
	}
	return nil
}

// Point mirrors the Win32 POINT structure.
type Point struct{ X, Y int32 }

// CursorInfo mirrors the Win32 CURSORINFO structure.
type CursorInfo struct {
	Size         uint32
	Flags        uint32
	CursorHandle HICON
	ScreenPos    Point
}

// GetCursorInfo returns the current global cursor state -- handle,
// visibility, and screen position -- used to composite the cursor onto a
// captured frame (BitBlt alone never captures it; the cursor is a separate
// system overlay, not part of any window's device context).
func GetCursorInfo() (CursorInfo, error) {
	ci := CursorInfo{Size: 24} // sizeof(CURSORINFO) on 64-bit: 4+4+8+4+4=24
	r1, _, err := procGetCursorInfo.Call(uintptr(unsafe.Pointer(&ci)))
	if r1 == 0 {
		return CursorInfo{}, fmt.Errorf("win32: GetCursorInfo: %w", err)
	}
	return ci, nil
}

// CursorVisible reports whether ci represents a currently-shown cursor.
func (ci CursorInfo) CursorVisible() bool {
	return ci.Flags&cursorShowing != 0
}

// DrawIconEx draws hIcon (typically a CursorInfo.CursorHandle) onto hdc at
// (x,y) at its natural size.
func DrawIconEx(hdc HDC, x, y int32, hIcon HICON) error {
	r1, _, err := procDrawIconEx.Call(
		uintptr(hdc), uintptr(x), uintptr(y), uintptr(hIcon),
		0, 0, // cxWidth, cyWidth: 0 = use the icon's actual size
		0,      // istepIfAniCur
		0,      // hbrFlickerFreeDraw
		0x0003, // DI_NORMAL (draw both mask and image)
	)
	if r1 == 0 {
		return fmt.Errorf("win32: DrawIconEx: %w", err)
	}
	return nil
}

// MouseInput and KeybdInput are the two INPUT-structure variants
// SendInput accepts, laid out to match the true Win32 INPUT struct size on
// 64-bit Windows (40 bytes: a 4-byte type discriminant, 4 bytes of
// alignment padding, then a union sized to its largest member,
// MOUSEINPUT at 32 bytes -- KEYBDINPUT's own fields only fill 24 of those
// 32 union bytes, hence the trailing padding field below). SendInput
// rejects any call whose cbSize doesn't exactly match sizeof(INPUT), so
// both types must report 40 bytes via unsafe.Sizeof regardless of which
// one is actually used.
type MouseInput struct {
	Type      uint32
	_         uint32
	Dx, Dy    int32
	MouseData uint32
	DwFlags   uint32
	Time      uint32
	_         uint32
	ExtraInfo uint64
}

type KeybdInput struct {
	Type      uint32
	_         uint32
	WVk       uint16
	WScan     uint16
	DwFlags   uint32
	Time      uint32
	_         uint32
	ExtraInfo uint64
	_         uint64 // pad to the full 40-byte INPUT size (union sized to MOUSEINPUT)
}

// SendMouseInput injects one mouse event.
func SendMouseInput(dx, dy int32, mouseData, flags uint32) error {
	in := MouseInput{Type: inputMouse, Dx: dx, Dy: dy, MouseData: mouseData, DwFlags: flags}
	r1, _, err := procSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
	if r1 == 0 {
		return fmt.Errorf("win32: SendInput (mouse): %w", err)
	}
	return nil
}

// SendKeybdInput injects one keyboard event.
func SendKeybdInput(vk uint16, down bool) error {
	flags := uint32(0)
	if !down {
		flags = keyeventfKeyUp
	}
	in := KeybdInput{Type: inputKeyboard, WVk: vk, DwFlags: flags}
	r1, _, err := procSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
	if r1 == 0 {
		return fmt.Errorf("win32: SendInput (keyboard): %w", err)
	}
	return nil
}
