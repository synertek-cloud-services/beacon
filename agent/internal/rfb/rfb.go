// Package rfb implements just enough of the RFB (Remote Framebuffer)
// protocol, RFC 6143, to run a minimal VNC-compatible server: the
// ProtocolVersion/Security/Init handshake, Raw-encoding FramebufferUpdate,
// and the client input message types (KeyEvent/PointerEvent). This is the
// server side only, and deliberately narrow -- see agent/internal/rfbserver
// for the orchestration built on top of this codec, and Beacon's own
// CLAUDE.md "Web Remote" section for the full v1 scope this package sits
// inside of.
package rfb

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
)

const protocolVersion = "RFB 003.008\n"

const (
	securityTypeNone = 1

	clientMsgSetPixelFormat           = 0
	clientMsgSetEncodings             = 2
	clientMsgFramebufferUpdateRequest = 3
	clientMsgKeyEvent                 = 4
	clientMsgPointerEvent             = 5
	clientMsgClientCutText            = 6

	serverMsgFramebufferUpdate = 0

	// EncodingRaw is the encoding used for ordinary screen-content
	// rectangles -- the only one this server sends for those.
	EncodingRaw int32 = 0

	// EncodingCursorPseudo (RFC 6143 §7.7.2, pseudo-encoding -239) lets the
	// server tell a supporting client what the cursor looks like, so the
	// client can render it locally at the user's own mouse position --
	// zero network round-trip for cursor movement, instead of every pixel
	// of movement requiring a full capture-and-send cycle. Only sent to a
	// client that declared support for it via SetEncodings; see
	// agent/internal/rfbserver.
	EncodingCursorPseudo int32 = -239
)

// PixelFormat mirrors RFC 6143 §7.4's 16-byte PIXEL_FORMAT structure.
type PixelFormat struct {
	BitsPerPixel                    uint8
	Depth                           uint8
	BigEndian                       bool
	TrueColor                       bool
	RedMax, GreenMax, BlueMax       uint16
	RedShift, GreenShift, BlueShift uint8
}

// Encode returns the 16-byte wire encoding of pf.
func (pf PixelFormat) Encode() [16]byte {
	var b [16]byte
	b[0] = pf.BitsPerPixel
	b[1] = pf.Depth
	b[2] = boolByte(pf.BigEndian)
	b[3] = boolByte(pf.TrueColor)
	binary.BigEndian.PutUint16(b[4:6], pf.RedMax)
	binary.BigEndian.PutUint16(b[6:8], pf.GreenMax)
	binary.BigEndian.PutUint16(b[8:10], pf.BlueMax)
	b[10] = pf.RedShift
	b[11] = pf.GreenShift
	b[12] = pf.BlueShift
	// b[13:16] is padding, left zero.
	return b
}

// DecodePixelFormat parses a 16-byte PIXEL_FORMAT structure.
func DecodePixelFormat(b []byte) (PixelFormat, error) {
	if len(b) < 16 {
		return PixelFormat{}, fmt.Errorf("rfb: PixelFormat: need 16 bytes, got %d", len(b))
	}
	return PixelFormat{
		BitsPerPixel: b[0],
		Depth:        b[1],
		BigEndian:    b[2] != 0,
		TrueColor:    b[3] != 0,
		RedMax:       binary.BigEndian.Uint16(b[4:6]),
		GreenMax:     binary.BigEndian.Uint16(b[6:8]),
		BlueMax:      binary.BigEndian.Uint16(b[8:10]),
		RedShift:     b[10],
		GreenShift:   b[11],
		BlueShift:    b[12],
	}, nil
}

func boolByte(b bool) uint8 {
	if b {
		return 1
	}
	return 0
}

// WriteProtocolVersion sends this server's RFB version line.
func WriteProtocolVersion(w io.Writer) error {
	_, err := w.Write([]byte(protocolVersion))
	return err
}

// ReadProtocolVersion reads the client's 12-byte RFB version line.
func ReadProtocolVersion(r io.Reader) (string, error) {
	var b [12]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return "", fmt.Errorf("rfb: read protocol version: %w", err)
	}
	return string(b[:]), nil
}

// WriteSecurityHandshake offers exactly one security type: None. The
// relay's own per-session auth token already gates who can open this
// WebSocket at all, so a second VNC-level auth layer is redundant for v1.
func WriteSecurityHandshake(w io.Writer) error {
	_, err := w.Write([]byte{1, securityTypeNone})
	return err
}

// ReadSecurityChoice reads the client's chosen security type.
func ReadSecurityChoice(r io.Reader) (byte, error) {
	var b [1]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return 0, fmt.Errorf("rfb: read security choice: %w", err)
	}
	return b[0], nil
}

// WriteSecurityResult sends the 4-byte SecurityResult message (RFB 3.8
// sends this even for security type None, unlike 3.3/3.7).
func WriteSecurityResult(w io.Writer, ok bool) error {
	var v uint32
	if !ok {
		v = 1
	}
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], v)
	_, err := w.Write(b[:])
	return err
}

// ReadClientInit reads the 1-byte ClientInit shared-flag.
func ReadClientInit(r io.Reader) (shared bool, err error) {
	var b [1]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return false, fmt.Errorf("rfb: read ClientInit: %w", err)
	}
	return b[0] != 0, nil
}

// WriteServerInit sends the ServerInit message: framebuffer dimensions,
// this server's default pixel format, and a desktop name.
func WriteServerInit(w io.Writer, width, height uint16, pf PixelFormat, name string) error {
	buf := make([]byte, 0, 24+len(name))
	var dims [4]byte
	binary.BigEndian.PutUint16(dims[0:2], width)
	binary.BigEndian.PutUint16(dims[2:4], height)
	buf = append(buf, dims[:]...)
	pfb := pf.Encode()
	buf = append(buf, pfb[:]...)
	var nameLen [4]byte
	binary.BigEndian.PutUint32(nameLen[:], uint32(len(name)))
	buf = append(buf, nameLen[:]...)
	buf = append(buf, []byte(name)...)
	_, err := w.Write(buf)
	return err
}

// ClientMessage is the parsed form of any client-to-server RFB message.
type ClientMessage interface{ isClientMessage() }

type SetPixelFormatMsg struct{ PixelFormat }
type SetEncodingsMsg struct{ Encodings []int32 }
type FramebufferUpdateRequestMsg struct {
	Incremental bool
	X, Y, W, H  uint16
}
type KeyEventMsg struct {
	Down   bool
	Keysym uint32
}
type PointerEventMsg struct {
	ButtonMask uint8
	X, Y       uint16
}
type ClientCutTextMsg struct{ Text string }

func (SetPixelFormatMsg) isClientMessage()           {}
func (SetEncodingsMsg) isClientMessage()             {}
func (FramebufferUpdateRequestMsg) isClientMessage() {}
func (KeyEventMsg) isClientMessage()                 {}
func (PointerEventMsg) isClientMessage()             {}
func (ClientCutTextMsg) isClientMessage()            {}

// maxClientCutText bounds a maliciously/buggily large ClientCutText length
// field so a single message can't force an unbounded allocation.
const maxClientCutText = 1 << 20

// ReadClientMessage reads and decodes one client-to-server RFB message.
func ReadClientMessage(r io.Reader) (ClientMessage, error) {
	var mt [1]byte
	if _, err := io.ReadFull(r, mt[:]); err != nil {
		return nil, err // EOF/closed connection propagates as-is
	}

	switch mt[0] {
	case clientMsgSetPixelFormat:
		var b [7]byte // 3 padding + 16 pixel-format, but we already consumed the type byte
		if _, err := io.ReadFull(r, b[:3]); err != nil {
			return nil, fmt.Errorf("rfb: SetPixelFormat padding: %w", err)
		}
		var pfb [16]byte
		if _, err := io.ReadFull(r, pfb[:]); err != nil {
			return nil, fmt.Errorf("rfb: SetPixelFormat body: %w", err)
		}
		pf, err := DecodePixelFormat(pfb[:])
		if err != nil {
			return nil, err
		}
		return SetPixelFormatMsg{pf}, nil

	case clientMsgSetEncodings:
		var hdr [3]byte // 1 padding + 2 count
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return nil, fmt.Errorf("rfb: SetEncodings header: %w", err)
		}
		count := binary.BigEndian.Uint16(hdr[1:3])
		encs := make([]int32, count)
		for i := range encs {
			var eb [4]byte
			if _, err := io.ReadFull(r, eb[:]); err != nil {
				return nil, fmt.Errorf("rfb: SetEncodings entry %d: %w", i, err)
			}
			encs[i] = int32(binary.BigEndian.Uint32(eb[:]))
		}
		return SetEncodingsMsg{encs}, nil

	case clientMsgFramebufferUpdateRequest:
		var b [9]byte
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return nil, fmt.Errorf("rfb: FramebufferUpdateRequest body: %w", err)
		}
		return FramebufferUpdateRequestMsg{
			Incremental: b[0] != 0,
			X:           binary.BigEndian.Uint16(b[1:3]),
			Y:           binary.BigEndian.Uint16(b[3:5]),
			W:           binary.BigEndian.Uint16(b[5:7]),
			H:           binary.BigEndian.Uint16(b[7:9]),
		}, nil

	case clientMsgKeyEvent:
		var b [7]byte
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return nil, fmt.Errorf("rfb: KeyEvent body: %w", err)
		}
		return KeyEventMsg{
			Down:   b[0] != 0,
			Keysym: binary.BigEndian.Uint32(b[3:7]),
		}, nil

	case clientMsgPointerEvent:
		var b [5]byte
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return nil, fmt.Errorf("rfb: PointerEvent body: %w", err)
		}
		return PointerEventMsg{
			ButtonMask: b[0],
			X:          binary.BigEndian.Uint16(b[1:3]),
			Y:          binary.BigEndian.Uint16(b[3:5]),
		}, nil

	case clientMsgClientCutText:
		var hdr [7]byte // 3 padding + 4 length
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return nil, fmt.Errorf("rfb: ClientCutText header: %w", err)
		}
		length := binary.BigEndian.Uint32(hdr[3:7])
		if length > maxClientCutText {
			return nil, fmt.Errorf("rfb: ClientCutText length %d exceeds max %d", length, maxClientCutText)
		}
		text := make([]byte, length)
		if _, err := io.ReadFull(r, text); err != nil {
			return nil, fmt.Errorf("rfb: ClientCutText body: %w", err)
		}
		return ClientCutTextMsg{string(text)}, nil

	default:
		return nil, fmt.Errorf("rfb: unknown client message type %d", mt[0])
	}
}

// Rectangle is one FramebufferUpdate rectangle. Encoding defaults to Raw
// (its zero value, 0, equals EncodingRaw) -- ordinary screen-content
// rectangles never need to set it explicitly. Pixels must already be
// packed to match the wire format Encoding implies: for EncodingRaw, the
// negotiated PixelFormat with length W*H*bytesPerPixel (see PackRow); for
// EncodingCursorPseudo, pixel data immediately followed by the shape
// bitmask (see NewCursorRectangle, which builds this correctly rather than
// requiring a caller to hand-assemble it).
type Rectangle struct {
	X, Y, W, H uint16
	Encoding   int32
	Pixels     []byte
}

// NewCursorRectangle builds a Rectangle for EncodingCursorPseudo. x/y are
// the cursor's hotspot (not top-left -- RFC 6143 §7.7.2), pixels is w*h
// pixel values already packed to the negotiated PixelFormat (see
// PackRow), and opaque reports whether a given (col, row) pixel is part of
// the visible cursor shape (true) or transparent (false); it's packed into
// the mask bitmask this function builds, so callers never hand-assemble
// that format themselves.
func NewCursorRectangle(hotspotX, hotspotY, w, h uint16, pixels []byte, opaque func(col, row uint16) bool) Rectangle {
	maskRowBytes := int(w+7) / 8
	mask := make([]byte, maskRowBytes*int(h))
	for row := uint16(0); row < h; row++ {
		for col := uint16(0); col < w; col++ {
			if !opaque(col, row) {
				continue
			}
			// MSB-first within each byte, per RFC 6143 §7.7.2.
			mask[int(row)*maskRowBytes+int(col)/8] |= 0x80 >> (col % 8)
		}
	}
	return Rectangle{
		X: hotspotX, Y: hotspotY, W: w, H: h,
		Encoding: EncodingCursorPseudo,
		Pixels:   append(append([]byte(nil), pixels...), mask...),
	}
}

// WriteFramebufferUpdate sends a FramebufferUpdate message containing the
// given rectangles, each using its own Encoding.
func WriteFramebufferUpdate(w io.Writer, rects []Rectangle) error {
	bw := bufio.NewWriter(w)

	var hdr [4]byte
	hdr[0] = serverMsgFramebufferUpdate
	// hdr[1] is padding.
	binary.BigEndian.PutUint16(hdr[2:4], uint16(len(rects)))
	if _, err := bw.Write(hdr[:]); err != nil {
		return err
	}

	for _, rect := range rects {
		var rb [12]byte
		binary.BigEndian.PutUint16(rb[0:2], rect.X)
		binary.BigEndian.PutUint16(rb[2:4], rect.Y)
		binary.BigEndian.PutUint16(rb[4:6], rect.W)
		binary.BigEndian.PutUint16(rb[6:8], rect.H)
		binary.BigEndian.PutUint32(rb[8:12], uint32(rect.Encoding))
		if _, err := bw.Write(rb[:]); err != nil {
			return err
		}
		if _, err := bw.Write(rect.Pixels); err != nil {
			return err
		}
	}

	return bw.Flush()
}

// isIdentityBGRA32 reports whether pf is byte-for-byte identical to the
// source's own 32bpp little-endian BGRA layout -- i.e. packing would be a
// pixel = (R<<16)|(G<<8)|B computation written little-endian, which lands
// R/G/B in exactly the same byte positions the BGRA source already has
// them in. This is the format real noVNC actually negotiates in practice
// (confirmed live), so it's worth a dedicated bulk-copy fast path rather
// than running every pixel through PackRow's general shift/multiply loop.
func isIdentityBGRA32(pf PixelFormat) bool {
	return pf.BitsPerPixel == 32 && !pf.BigEndian &&
		pf.RedMax == 255 && pf.GreenMax == 255 && pf.BlueMax == 255 &&
		pf.RedShift == 16 && pf.GreenShift == 8 && pf.BlueShift == 0
}

// PackRow packs one row of src (4 bytes per pixel, BGRA byte order -- the
// layout GetDIBits produces for a 32bpp BI_RGB bitmap) into dst according
// to pf. dst must be pre-sized to (len(src)/4)*pf.BitsPerPixel/8 bytes.
// Written generally, not just for the one 32bpp/depth-24 format real noVNC
// happens to negotiate, so it can be table-tested against several formats
// -- but that common case gets a dedicated bulk-copy fast path (see
// isIdentityBGRA32) instead of running every pixel through the shift/
// multiply loop below, since per-pixel Go math over a full 1080p+ frame on
// every single FramebufferUpdateRequest was the dominant CPU cost behind
// real-hardware-observed Web Remote lag (see CLAUDE.md's Web Remote
// section) -- confirmed by a LAN test where network bandwidth was never
// the bottleneck.
func PackRow(dst []byte, pf PixelFormat, src []byte) {
	if isIdentityBGRA32(pf) {
		// Bulk copy (a single memmove, not a per-pixel loop) since B/G/R
		// already land in the exact byte positions this pf's shifts would
		// compute anyway. The 4th source byte (alpha) is zeroed to match
		// what the general path below always produces there (it never has
		// any shift landing in that byte) -- a cheap strided write, still
		// far less work than the multiply/shift math it replaces.
		copy(dst, src)
		for i := 3; i < len(dst); i += 4 {
			dst[i] = 0
		}
		return
	}

	bytesPerPixel := int(pf.BitsPerPixel) / 8
	pixelCount := len(src) / 4

	for i := 0; i < pixelCount; i++ {
		s := src[i*4 : i*4+4]
		// src is BGRA: s[0]=B, s[1]=G, s[2]=R, s[3]=A (alpha unused).
		b, g, rr := uint32(s[0]), uint32(s[1]), uint32(s[2])

		r := (rr * uint32(pf.RedMax)) / 255
		gg := (g * uint32(pf.GreenMax)) / 255
		bb := (b * uint32(pf.BlueMax)) / 255

		pixel := (r << pf.RedShift) | (gg << pf.GreenShift) | (bb << pf.BlueShift)

		d := dst[i*bytesPerPixel : i*bytesPerPixel+bytesPerPixel]
		switch bytesPerPixel {
		case 1:
			d[0] = byte(pixel)
		case 2:
			if pf.BigEndian {
				binary.BigEndian.PutUint16(d, uint16(pixel))
			} else {
				binary.LittleEndian.PutUint16(d, uint16(pixel))
			}
		case 4:
			if pf.BigEndian {
				binary.BigEndian.PutUint32(d, pixel)
			} else {
				binary.LittleEndian.PutUint32(d, pixel)
			}
		default:
			// Not a real-world case (RFB pixel formats are always 8/16/32
			// bpp) -- leave dst untouched rather than panic on bad input.
		}
	}
}
