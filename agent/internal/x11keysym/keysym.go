// Package x11keysym maps X11 keysyms (as sent in RFB's KeyEvent message,
// RFC 6143 §7.5.4 -- RFB reuses X11's keysym values rather than defining
// its own) to Windows virtual-key codes, for injection via SendInput.
//
// Deliberately not exhaustive -- covers ASCII letters/digits/space, the
// common named keys (arrows, Enter, Backspace, Tab, Escape, modifiers,
// F1-F12, navigation cluster) and common US-layout punctuation, including
// the shifted number-row symbols. Dead keys, IME composition, and
// non-US-layout punctuation are real, well-understood, tedious work left
// as a fast-follow -- an unmapped key is simply dropped by the caller
// (agent/internal/screeninject), never an error.
//
// Punctuation VK codes assume a US keyboard layout: Windows' SendInput
// takes a virtual-key code, not a character, and the OS's currently active
// keyboard layout decides what character that VK code actually produces --
// a non-US layout could send whatever this table sends to a visually
// different physical key.
package x11keysym

const (
	vkBack      = 0x08
	vkTab       = 0x09
	vkReturn    = 0x0D
	vkPause     = 0x13
	vkCapital   = 0x14
	vkEscape    = 0x1B
	vkSpace     = 0x20
	vkPrior     = 0x21 // Page Up
	vkNext      = 0x22 // Page Down
	vkEnd       = 0x23
	vkHome      = 0x24
	vkLeft      = 0x25
	vkUp        = 0x26
	vkRight     = 0x27
	vkDown      = 0x28
	vkSnapshot  = 0x2C // Print Screen
	vkInsert    = 0x2D
	vkDelete    = 0x2E
	vk0         = 0x30
	vkA         = 0x41
	vkLWin      = 0x5B
	vkRWin      = 0x5C
	vkApps      = 0x5D
	vkF1        = 0x70
	vkNumLock   = 0x90
	vkScroll    = 0x91
	vkLShift    = 0xA0
	vkRShift    = 0xA1
	vkLControl  = 0xA2
	vkRControl  = 0xA3
	vkLMenu     = 0xA4
	vkRMenu     = 0xA5
	vkOEM1      = 0xBA // ;: on US layout
	vkOEMPlus   = 0xBB // =+
	vkOEMComma  = 0xBC // ,<
	vkOEMMinus  = 0xBD // -_
	vkOEMPeriod = 0xBE // .>
	vkOEM2      = 0xBF // /?
	vkOEM3      = 0xC0 // `~
	vkOEM4      = 0xDB // [{
	vkOEM5      = 0xDC // \|
	vkOEM6      = 0xDD // ]}
	vkOEM7      = 0xDE // '"
)

var table = map[uint32]uint16{
	// ASCII space and control keys.
	0x0020: vkSpace,
	0xFF08: vkBack,   // XK_BackSpace
	0xFF09: vkTab,    // XK_Tab
	0xFF0D: vkReturn, // XK_Return
	0xFF1B: vkEscape, // XK_Escape
	0xFFFF: vkDelete, // XK_Delete

	// Navigation cluster.
	0xFF50: vkHome,   // XK_Home
	0xFF51: vkLeft,   // XK_Left
	0xFF52: vkUp,     // XK_Up
	0xFF53: vkRight,  // XK_Right
	0xFF54: vkDown,   // XK_Down
	0xFF55: vkPrior,  // XK_Page_Up
	0xFF56: vkNext,   // XK_Page_Down
	0xFF57: vkEnd,    // XK_End
	0xFF63: vkInsert, // XK_Insert

	// Modifiers and locks (both sides, matching what noVNC actually sends).
	0xFFE1: vkLShift,   // XK_Shift_L
	0xFFE2: vkRShift,   // XK_Shift_R
	0xFFE3: vkLControl, // XK_Control_L
	0xFFE4: vkRControl, // XK_Control_R
	0xFFE5: vkCapital,  // XK_Caps_Lock
	0xFFE9: vkLMenu,    // XK_Alt_L
	0xFFEA: vkRMenu,    // XK_Alt_R
	0xFFEB: vkLWin,     // XK_Super_L
	0xFFEC: vkRWin,     // XK_Super_R
	0xFF7F: vkNumLock,  // XK_Num_Lock
	0xFF14: vkScroll,   // XK_Scroll_Lock
	0xFF61: vkSnapshot, // XK_Print
	0xFF13: vkPause,    // XK_Pause
	0xFF67: vkApps,     // XK_Menu

	// Unshifted punctuation (US layout).
	0x002D: vkOEMMinus,  // - hyphen
	0x003D: vkOEMPlus,   // = equal
	0x005B: vkOEM4,      // [ bracketleft
	0x005D: vkOEM6,      // ] bracketright
	0x005C: vkOEM5,      // \ backslash
	0x003B: vkOEM1,      // ; semicolon
	0x0027: vkOEM7,      // ' apostrophe
	0x0060: vkOEM3,      // ` grave
	0x002C: vkOEMComma,  // , comma
	0x002E: vkOEMPeriod, // . period
	0x002F: vkOEM2,      // / slash

	// Shifted number-row and other shifted punctuation -- Windows applies
	// the actual shift transform based on real modifier-key state (which
	// noVNC also sends as separate Shift KeyEvents around these), so these
	// map to the SAME VK as their unshifted key.
	0x0021: vk0 + 1,     // ! exclam        -> VK '1'
	0x0040: vk0 + 2,     // @ at            -> VK '2'
	0x0023: vk0 + 3,     // # numbersign    -> VK '3'
	0x0024: vk0 + 4,     // $ dollar        -> VK '4'
	0x0025: vk0 + 5,     // % percent       -> VK '5'
	0x005E: vk0 + 6,     // ^ asciicircum   -> VK '6'
	0x0026: vk0 + 7,     // & ampersand     -> VK '7'
	0x002A: vk0 + 8,     // * asterisk      -> VK '8'
	0x0028: vk0 + 9,     // ( parenleft     -> VK '9'
	0x0029: vk0,         // ) parenright    -> VK '0'
	0x005F: vkOEMMinus,  // _ underscore
	0x002B: vkOEMPlus,   // + plus
	0x007B: vkOEM4,      // { braceleft
	0x007D: vkOEM6,      // } braceright
	0x007C: vkOEM5,      // | bar
	0x003A: vkOEM1,      // : colon
	0x0022: vkOEM7,      // " quotedbl
	0x007E: vkOEM3,      // ~ asciitilde
	0x003C: vkOEMComma,  // < less
	0x003E: vkOEMPeriod, // > greater
	0x003F: vkOEM2,      // ? question
}

func init() {
	// Digits '0'-'9': X11 keysyms 0x0030-0x0039 coincide numerically with
	// their ASCII code points, which also happen to equal the Windows VK
	// codes for the top-row digit keys (0x30-0x39) -- true only for
	// digits and letters, never assume it for punctuation (see the
	// explicit table above, which exists precisely because this
	// coincidence does NOT hold there).
	for d := uint32(0); d <= 9; d++ {
		table[0x0030+d] = uint16(vk0 + d)
	}
	// Uppercase 'A'-'Z': keysym 0x0041-0x005A, VK 0x41-0x5A (also coincide).
	for c := uint32(0); c < 26; c++ {
		table[0x0041+c] = uint16(vkA + c)
	}
	// Lowercase 'a'-'z': keysym 0x0061-0x007A maps to the SAME VK code as
	// uppercase -- Windows VK codes don't distinguish case, actual shift
	// state (independently injected) determines it.
	for c := uint32(0); c < 26; c++ {
		table[0x0061+c] = uint16(vkA + c)
	}
	// F1-F12: keysyms 0xFFBE-0xFFC9, VK 0x70-0x7B.
	for f := uint32(0); f < 12; f++ {
		table[0xFFBE+f] = uint16(vkF1 + f)
	}
}

// ToVirtualKey maps an X11 keysym to a Windows virtual-key code. ok is
// false for any keysym not in this table's deliberately-non-exhaustive
// coverage -- callers should drop the event, not treat it as an error.
func ToVirtualKey(keysym uint32) (vk uint16, ok bool) {
	vk, ok = table[keysym]
	return vk, ok
}
