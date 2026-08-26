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
	keyeventfKeyUp   = 0x0002
	keyeventfUnicode = 0x0004

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
	procOpenInputDesktop              = moduser32.NewProc("OpenInputDesktop")
	procSetThreadDesktop              = moduser32.NewProc("SetThreadDesktop")
	procGetUserObjectInformationW     = moduser32.NewProc("GetUserObjectInformationW")
	procCloseDesktop                  = moduser32.NewProc("CloseDesktop")
)

// HDESK mirrors the Win32 HDESK handle type -- a desktop object, distinct
// from a window station (HWINSTA, not wrapped here -- every caller in this
// codebase only ever needs winsta0, the one interactive window station per
// session, already reached implicitly via CreateProcessAsUser's own
// `winsta0\default` desktop string in usersession_windows.go).
type HDESK uintptr

const (
	// genericAll is GENERIC_ALL, requested for OpenInputDesktop rather than
	// a hand-enumerated DESKTOP_* rights list -- matches this codebase's
	// own established preference (see install_windows.go's
	// setRecoveryActions doc comment) for avoiding a subtly-incomplete
	// enumerated-rights bug class.
	genericAll = 0x10000000

	// uoiName is the GetUserObjectInformationW index for a desktop's name
	// (e.g. "Default", the ordinary interactive desktop; "Winlogon", the
	// secure desktop a UAC consent/credential prompt or the lock screen
	// renders on; "Disconn"/"Screen-saver" in other states).
	uoiName = 2
)

// OpenInputDesktop returns a handle to whichever desktop is currently
// receiving user input. Opening the secure ("Winlogon") desktop
// specifically requires the calling process to hold SE_TCB_NAME-class
// privilege (SYSTEM) -- a plain Administrator token, split-token or not,
// cannot open it; this is the entire reason Beacon's SYSTEM-based Elevate
// exists rather than continuing to request an Administrator token.
func OpenInputDesktop() (HDESK, error) {
	r1, _, err := procOpenInputDesktop.Call(0, 0, genericAll)
	if r1 == 0 {
		return 0, fmt.Errorf("win32: OpenInputDesktop: %w", err)
	}
	return HDESK(r1), nil
}

// SetThreadDesktop attaches the *calling thread* (not the process) to
// hDesktop -- every subsequent GDI/SendInput call made from this exact
// thread operates against hDesktop until this is called again. Fails if
// the calling thread currently owns any window or hook on its current
// desktop, which never applies to this codebase's callers (screencapture/
// screeninject create no windows and install no hooks).
func SetThreadDesktop(hDesktop HDESK) error {
	r1, _, err := procSetThreadDesktop.Call(uintptr(hDesktop))
	if r1 == 0 {
		return fmt.Errorf("win32: SetThreadDesktop: %w", err)
	}
	return nil
}

// DesktopName returns hDesktop's name via GetUserObjectInformationW
// (UOI_NAME) -- used to detect a desktop switch by comparing against the
// last-attached name, so SetThreadDesktop (a more consequential call) only
// runs on an actual transition, not on every check.
func DesktopName(hDesktop HDESK) (string, error) {
	var buf [64]uint16
	var needed uint32
	r1, _, err := procGetUserObjectInformationW.Call(
		uintptr(hDesktop),
		uintptr(uoiName),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)*2),
		uintptr(unsafe.Pointer(&needed)),
	)
	if r1 == 0 {
		return "", fmt.Errorf("win32: GetUserObjectInformationW: %w", err)
	}
	return windows.UTF16ToString(buf[:]), nil
}

// CloseDesktop releases a handle obtained from OpenInputDesktop. The
// desktop object itself stays alive via the calling thread's own
// attachment (SetThreadDesktop), not this handle -- safe, and intended, to
// close immediately after attaching.
func CloseDesktop(hDesktop HDESK) error {
	r1, _, err := procCloseDesktop.Call(uintptr(hDesktop))
	if r1 == 0 {
		return fmt.Errorf("win32: CloseDesktop: %w", err)
	}
	return nil
}

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

// SendUnicodeKeybdInput injects one keyboard event carrying a raw UTF-16
// code unit rather than a virtual-key code -- KEYEVENTF_UNICODE, Windows'
// own mechanism for typing an arbitrary Unicode character with no VK
// mapping or keyboard-layout dependency at all (the same primitive
// AutoHotkey-style "SendText"/autotype tools use). wVk must be 0 for this
// flag combination; unit is a single UTF-16 code unit -- a supplementary-
// plane character needs its two surrogate halves sent as two separate
// calls, same as any other UTF-16 encoding.
func SendUnicodeKeybdInput(unit uint16, down bool) error {
	flags := uint32(keyeventfUnicode)
	if !down {
		flags |= keyeventfKeyUp
	}
	in := KeybdInput{Type: inputKeyboard, WScan: unit, DwFlags: flags}
	r1, _, err := procSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
	if r1 == 0 {
		return fmt.Errorf("win32: SendInput (unicode keyboard): %w", err)
	}
	return nil
}

// RECT mirrors the Win32 RECT structure. Coordinates are virtual-desktop-
// relative, not screen-local -- a monitor positioned above or left of the
// primary has genuinely negative Left/Top values, by Windows' own design
// (the primary monitor's own origin is always (0,0)).
type RECT struct {
	Left, Top, Right, Bottom int32
}

// HMONITOR mirrors the Win32 HMONITOR handle type.
type HMONITOR uintptr

// monitorInfoEx mirrors the Win32 MONITORINFOEXW structure -- the extended
// variant carrying szDevice (CCHDEVICENAME=32 wide chars, e.g.
// `\\.\DISPLAY1`), not just the base MONITORINFO's rcMonitor/rcWork/
// dwFlags. Unexported: EnumMonitors below is the only consumer, nothing
// else needs the raw GetMonitorInfoW shape.
type monitorInfoEx struct {
	cbSize    uint32
	rcMonitor RECT
	rcWork    RECT
	dwFlags   uint32
	szDevice  [32]uint16
}

// monitorInfoFPrimary is MONITORINFOF_PRIMARY, the dwFlags bit marking the
// system's primary display.
const monitorInfoFPrimary = 0x00000001

const (
	SM_XVIRTUALSCREEN  = 76
	SM_YVIRTUALSCREEN  = 77
	SM_CXVIRTUALSCREEN = 78
	SM_CYVIRTUALSCREEN = 79

	// MouseEventFVirtualDesk normalizes SendInput's absolute coordinates
	// against the full virtual desktop (SM_C/XVIRTUALSCREEN above) instead
	// of just the primary monitor -- required for correct absolute-
	// coordinate targeting of any non-primary or negative-offset monitor.
	// Standard, documented Win32 technique, but genuinely unexercised in
	// this codebase until now (zero prior references) -- flagged with the
	// same "needs real-hardware verification" honesty as this package's
	// other hand-derived Windows internals (the SendInput INPUT struct
	// layout): if clicks land in the wrong place on a secondary or
	// negative-offset monitor, this is the first thing to re-examine.
	MouseEventFVirtualDesk = 0x4000
)

var (
	procEnumDisplayMonitors = moduser32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfoW     = moduser32.NewProc("GetMonitorInfoW")
)

// MonitorInfo is one display returned by EnumMonitors.
type MonitorInfo struct {
	// DeviceName is the real GDI display identity (e.g. `\\.\DISPLAY1`) --
	// stable, meaningful identity to key off of, unlike a recomputed
	// enumeration index (which silently points at a different physical
	// monitor if topology changes between two separate EnumMonitors calls
	// in two different processes -- the actual reason this codebase
	// deliberately picked szDevice over a sorted-index scheme).
	DeviceName string
	Rect       RECT
	Primary    bool
}

// EnumMonitors returns every display attached to this machine, in
// virtual-desktop coordinates (negative Left/Top for a monitor positioned
// above/left of the primary). This is this codebase's first use of
// windows.NewCallback -- EnumDisplayMonitors is a real Win32 enumeration
// API that invokes a caller-supplied function pointer once per monitor,
// unlike every other win32 wrapper in this package, which are simple
// one-shot calls.
func EnumMonitors() ([]MonitorInfo, error) {
	var monitors []MonitorInfo
	cb := windows.NewCallback(func(hMonitor uintptr, _ uintptr, _ uintptr, _ uintptr) uintptr {
		var mi monitorInfoEx
		mi.cbSize = uint32(unsafe.Sizeof(mi))
		r1, _, _ := procGetMonitorInfoW.Call(hMonitor, uintptr(unsafe.Pointer(&mi)))
		if r1 == 0 {
			return 1 // this one monitor's info failed to resolve -- keep enumerating the rest
		}
		monitors = append(monitors, MonitorInfo{
			DeviceName: windows.UTF16ToString(mi.szDevice[:]),
			Rect:       mi.rcMonitor,
			Primary:    mi.dwFlags&monitorInfoFPrimary != 0,
		})
		return 1 // BOOL TRUE -- continue enumeration
	})

	// hdc=0, lprcClip=0: enumerate every monitor on the system rather than
	// clipping to a particular device context's visible region.
	r1, _, err := procEnumDisplayMonitors.Call(0, 0, cb, 0)
	if r1 == 0 {
		return nil, fmt.Errorf("win32: EnumDisplayMonitors: %w", err)
	}
	if len(monitors) == 0 {
		return nil, fmt.Errorf("win32: EnumDisplayMonitors returned no monitors")
	}
	return monitors, nil
}
