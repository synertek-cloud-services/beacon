package rfb

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"
)

func TestProtocolVersionRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteProtocolVersion(&buf); err != nil {
		t.Fatalf("WriteProtocolVersion: %v", err)
	}
	if got := buf.String(); got != "RFB 003.008\n" {
		t.Fatalf("version = %q, want %q", got, "RFB 003.008\n")
	}

	got, err := ReadProtocolVersion(bytes.NewReader([]byte("RFB 003.008\n")))
	if err != nil {
		t.Fatalf("ReadProtocolVersion: %v", err)
	}
	if got != "RFB 003.008\n" {
		t.Fatalf("read version = %q", got)
	}
}

func TestReadProtocolVersionShort(t *testing.T) {
	if _, err := ReadProtocolVersion(bytes.NewReader([]byte("short"))); err == nil {
		t.Fatal("expected error on truncated protocol version")
	}
}

func TestSecurityHandshake(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteSecurityHandshake(&buf); err != nil {
		t.Fatalf("WriteSecurityHandshake: %v", err)
	}
	want := []byte{1, securityTypeNone}
	if !bytes.Equal(buf.Bytes(), want) {
		t.Fatalf("handshake bytes = %v, want %v", buf.Bytes(), want)
	}

	choice, err := ReadSecurityChoice(bytes.NewReader([]byte{securityTypeNone}))
	if err != nil {
		t.Fatalf("ReadSecurityChoice: %v", err)
	}
	if choice != securityTypeNone {
		t.Fatalf("choice = %d, want %d", choice, securityTypeNone)
	}
}

func TestSecurityResult(t *testing.T) {
	var okBuf bytes.Buffer
	if err := WriteSecurityResult(&okBuf, true); err != nil {
		t.Fatalf("WriteSecurityResult(true): %v", err)
	}
	if !bytes.Equal(okBuf.Bytes(), []byte{0, 0, 0, 0}) {
		t.Fatalf("ok result = %v, want all-zero", okBuf.Bytes())
	}

	var failBuf bytes.Buffer
	if err := WriteSecurityResult(&failBuf, false); err != nil {
		t.Fatalf("WriteSecurityResult(false): %v", err)
	}
	if !bytes.Equal(failBuf.Bytes(), []byte{0, 0, 0, 1}) {
		t.Fatalf("fail result = %v, want trailing 1", failBuf.Bytes())
	}
}

func TestClientInit(t *testing.T) {
	shared, err := ReadClientInit(bytes.NewReader([]byte{1}))
	if err != nil {
		t.Fatalf("ReadClientInit: %v", err)
	}
	if !shared {
		t.Fatal("expected shared=true")
	}

	shared, err = ReadClientInit(bytes.NewReader([]byte{0}))
	if err != nil {
		t.Fatalf("ReadClientInit: %v", err)
	}
	if shared {
		t.Fatal("expected shared=false")
	}
}

func testPixelFormat() PixelFormat {
	return PixelFormat{
		BitsPerPixel: 32, Depth: 24, BigEndian: false, TrueColor: true,
		RedMax: 255, GreenMax: 255, BlueMax: 255,
		RedShift: 16, GreenShift: 8, BlueShift: 0,
	}
}

func TestPixelFormatRoundTrip(t *testing.T) {
	pf := testPixelFormat()
	enc := pf.Encode()
	if len(enc) != 16 {
		t.Fatalf("encoded length = %d, want 16", len(enc))
	}
	got, err := DecodePixelFormat(enc[:])
	if err != nil {
		t.Fatalf("DecodePixelFormat: %v", err)
	}
	if got != pf {
		t.Fatalf("round-trip mismatch: got %+v, want %+v", got, pf)
	}
}

func TestDecodePixelFormatShort(t *testing.T) {
	if _, err := DecodePixelFormat(make([]byte, 10)); err == nil {
		t.Fatal("expected error on short PixelFormat buffer")
	}
}

func TestServerInit(t *testing.T) {
	var buf bytes.Buffer
	pf := testPixelFormat()
	if err := WriteServerInit(&buf, 1920, 1080, pf, "test-host"); err != nil {
		t.Fatalf("WriteServerInit: %v", err)
	}
	b := buf.Bytes()
	if binary.BigEndian.Uint16(b[0:2]) != 1920 {
		t.Fatalf("width = %d, want 1920", binary.BigEndian.Uint16(b[0:2]))
	}
	if binary.BigEndian.Uint16(b[2:4]) != 1080 {
		t.Fatalf("height = %d, want 1080", binary.BigEndian.Uint16(b[2:4]))
	}
	gotPF, err := DecodePixelFormat(b[4:20])
	if err != nil {
		t.Fatalf("DecodePixelFormat: %v", err)
	}
	if gotPF != pf {
		t.Fatalf("embedded pixel format mismatch: got %+v, want %+v", gotPF, pf)
	}
	nameLen := binary.BigEndian.Uint32(b[20:24])
	if nameLen != uint32(len("test-host")) {
		t.Fatalf("name length = %d, want %d", nameLen, len("test-host"))
	}
	if string(b[24:24+nameLen]) != "test-host" {
		t.Fatalf("name = %q", string(b[24:24+nameLen]))
	}
}

// --- Client message decode tests ---
// These hand-encode the wire bytes a real client would send (there's no
// client-side encoder in this server-only package), then decode via
// ReadClientMessage and check the parsed fields.

func TestReadSetPixelFormatMsg(t *testing.T) {
	pf := testPixelFormat()
	var buf bytes.Buffer
	buf.WriteByte(clientMsgSetPixelFormat)
	buf.Write([]byte{0, 0, 0}) // padding
	enc := pf.Encode()
	buf.Write(enc[:])

	msg, err := ReadClientMessage(&buf)
	if err != nil {
		t.Fatalf("ReadClientMessage: %v", err)
	}
	got, ok := msg.(SetPixelFormatMsg)
	if !ok {
		t.Fatalf("got %T, want SetPixelFormatMsg", msg)
	}
	if got.PixelFormat != pf {
		t.Fatalf("pixel format mismatch: got %+v, want %+v", got.PixelFormat, pf)
	}
}

func TestReadSetEncodingsMsg(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteByte(clientMsgSetEncodings)
	buf.WriteByte(0) // padding
	var count [2]byte
	binary.BigEndian.PutUint16(count[:], 2)
	buf.Write(count[:])
	for _, e := range []int32{0, -239} { // Raw, and a pseudo-encoding-shaped negative value
		var eb [4]byte
		binary.BigEndian.PutUint32(eb[:], uint32(e))
		buf.Write(eb[:])
	}

	msg, err := ReadClientMessage(&buf)
	if err != nil {
		t.Fatalf("ReadClientMessage: %v", err)
	}
	got, ok := msg.(SetEncodingsMsg)
	if !ok {
		t.Fatalf("got %T, want SetEncodingsMsg", msg)
	}
	want := []int32{0, -239}
	if len(got.Encodings) != len(want) || got.Encodings[0] != want[0] || got.Encodings[1] != want[1] {
		t.Fatalf("encodings = %v, want %v", got.Encodings, want)
	}
}

func TestReadFramebufferUpdateRequestMsg(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteByte(clientMsgFramebufferUpdateRequest)
	buf.WriteByte(1) // incremental
	for _, v := range []uint16{10, 20, 800, 600} {
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], v)
		buf.Write(b[:])
	}

	msg, err := ReadClientMessage(&buf)
	if err != nil {
		t.Fatalf("ReadClientMessage: %v", err)
	}
	got, ok := msg.(FramebufferUpdateRequestMsg)
	if !ok {
		t.Fatalf("got %T, want FramebufferUpdateRequestMsg", msg)
	}
	want := FramebufferUpdateRequestMsg{Incremental: true, X: 10, Y: 20, W: 800, H: 600}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestReadKeyEventMsg(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteByte(clientMsgKeyEvent)
	buf.WriteByte(1)        // down
	buf.Write([]byte{0, 0}) // padding
	var keysym [4]byte
	binary.BigEndian.PutUint32(keysym[:], 0xFF0D) // XK_Return
	buf.Write(keysym[:])

	msg, err := ReadClientMessage(&buf)
	if err != nil {
		t.Fatalf("ReadClientMessage: %v", err)
	}
	got, ok := msg.(KeyEventMsg)
	if !ok {
		t.Fatalf("got %T, want KeyEventMsg", msg)
	}
	if !got.Down || got.Keysym != 0xFF0D {
		t.Fatalf("got %+v", got)
	}
}

func TestReadPointerEventMsg(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteByte(clientMsgPointerEvent)
	buf.WriteByte(0x01) // left button down
	for _, v := range []uint16{123, 456} {
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], v)
		buf.Write(b[:])
	}

	msg, err := ReadClientMessage(&buf)
	if err != nil {
		t.Fatalf("ReadClientMessage: %v", err)
	}
	got, ok := msg.(PointerEventMsg)
	if !ok {
		t.Fatalf("got %T, want PointerEventMsg", msg)
	}
	want := PointerEventMsg{ButtonMask: 0x01, X: 123, Y: 456}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestReadClientCutTextMsg(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteByte(clientMsgClientCutText)
	buf.Write([]byte{0, 0, 0}) // padding
	text := "hello clipboard"
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(text)))
	buf.Write(length[:])
	buf.WriteString(text)

	msg, err := ReadClientMessage(&buf)
	if err != nil {
		t.Fatalf("ReadClientMessage: %v", err)
	}
	got, ok := msg.(ClientCutTextMsg)
	if !ok {
		t.Fatalf("got %T, want ClientCutTextMsg", msg)
	}
	if got.Text != text {
		t.Fatalf("text = %q, want %q", got.Text, text)
	}
}

func TestReadClientCutTextMsgRejectsOversized(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteByte(clientMsgClientCutText)
	buf.Write([]byte{0, 0, 0})
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], maxClientCutText+1)
	buf.Write(length[:])
	// Deliberately don't write the (huge) body -- ReadClientMessage must
	// reject based on the length field alone, before attempting the read.

	if _, err := ReadClientMessage(&buf); err == nil {
		t.Fatal("expected error for oversized ClientCutText length")
	}
}

func TestReadClientMessageUnknownType(t *testing.T) {
	if _, err := ReadClientMessage(bytes.NewReader([]byte{99})); err == nil {
		t.Fatal("expected error for unknown message type")
	}
}

func TestReadClientMessageTruncated(t *testing.T) {
	// A FramebufferUpdateRequest header promises 9 more bytes but only 3 follow.
	buf := bytes.NewReader([]byte{clientMsgFramebufferUpdateRequest, 0, 0, 0})
	if _, err := ReadClientMessage(buf); err == nil {
		t.Fatal("expected error on truncated message body")
	}
}

func TestReadClientMessageEOF(t *testing.T) {
	if _, err := ReadClientMessage(bytes.NewReader(nil)); err != io.EOF {
		t.Fatalf("expected io.EOF on empty reader, got %v", err)
	}
}

func TestWriteFramebufferUpdateSingleRect(t *testing.T) {
	var buf bytes.Buffer
	pixels := []byte{1, 2, 3, 4, 5, 6, 7, 8} // 2 pixels @ 4 bytes
	rects := []Rectangle{{X: 0, Y: 0, W: 2, H: 1, Pixels: pixels}}
	if err := WriteFramebufferUpdate(&buf, rects); err != nil {
		t.Fatalf("WriteFramebufferUpdate: %v", err)
	}

	b := buf.Bytes()
	if b[0] != serverMsgFramebufferUpdate {
		t.Fatalf("message type = %d, want %d", b[0], serverMsgFramebufferUpdate)
	}
	if binary.BigEndian.Uint16(b[2:4]) != 1 {
		t.Fatalf("rect count = %d, want 1", binary.BigEndian.Uint16(b[2:4]))
	}
	rectHdr := b[4:16]
	if binary.BigEndian.Uint16(rectHdr[4:6]) != 2 || binary.BigEndian.Uint16(rectHdr[6:8]) != 1 {
		t.Fatalf("rect w/h = %d/%d, want 2/1", binary.BigEndian.Uint16(rectHdr[4:6]), binary.BigEndian.Uint16(rectHdr[6:8]))
	}
	if int32(binary.BigEndian.Uint32(rectHdr[8:12])) != EncodingRaw {
		t.Fatalf("encoding = %d, want Raw (0)", int32(binary.BigEndian.Uint32(rectHdr[8:12])))
	}
	if !bytes.Equal(b[16:], pixels) {
		t.Fatalf("pixel data = %v, want %v", b[16:], pixels)
	}
}

func TestWriteFramebufferUpdateMultipleRects(t *testing.T) {
	var buf bytes.Buffer
	rects := []Rectangle{
		{X: 0, Y: 0, W: 1, H: 1, Pixels: []byte{1, 1, 1, 1}},
		{X: 0, Y: 1, W: 1, H: 1, Pixels: []byte{2, 2, 2, 2}},
		{X: 0, Y: 2, W: 1, H: 1, Pixels: []byte{3, 3, 3, 3}},
	}
	if err := WriteFramebufferUpdate(&buf, rects); err != nil {
		t.Fatalf("WriteFramebufferUpdate: %v", err)
	}
	b := buf.Bytes()
	if binary.BigEndian.Uint16(b[2:4]) != 3 {
		t.Fatalf("rect count = %d, want 3", binary.BigEndian.Uint16(b[2:4]))
	}
	// header(4) + 3 * (rectHeader(12) + pixels(4)) = 4 + 48 = 52
	if len(b) != 4+3*(12+4) {
		t.Fatalf("total length = %d, want %d", len(b), 4+3*(12+4))
	}
}

func TestPackRow32bppLittleEndian(t *testing.T) {
	pf := PixelFormat{
		BitsPerPixel: 32, Depth: 24, BigEndian: false, TrueColor: true,
		RedMax: 255, GreenMax: 255, BlueMax: 255,
		RedShift: 16, GreenShift: 8, BlueShift: 0,
	}
	// One BGRA pixel: B=0x10 G=0x20 R=0x30 A=0xFF (alpha ignored).
	src := []byte{0x10, 0x20, 0x30, 0xFF}
	dst := make([]byte, 4)
	PackRow(dst, pf, src)

	want := uint32(0x30)<<16 | uint32(0x20)<<8 | uint32(0x10)
	got := binary.LittleEndian.Uint32(dst)
	if got != want {
		t.Fatalf("packed pixel = %#x, want %#x", got, want)
	}
}

func TestPackRow32bppBigEndian(t *testing.T) {
	pf := PixelFormat{
		BitsPerPixel: 32, Depth: 24, BigEndian: true, TrueColor: true,
		RedMax: 255, GreenMax: 255, BlueMax: 255,
		RedShift: 16, GreenShift: 8, BlueShift: 0,
	}
	src := []byte{0x10, 0x20, 0x30, 0xFF}
	dst := make([]byte, 4)
	PackRow(dst, pf, src)

	want := uint32(0x30)<<16 | uint32(0x20)<<8 | uint32(0x10)
	got := binary.BigEndian.Uint32(dst)
	if got != want {
		t.Fatalf("packed pixel (BE) = %#x, want %#x", got, want)
	}
}

func TestPackRow16bpp565(t *testing.T) {
	pf := PixelFormat{
		BitsPerPixel: 16, Depth: 16, BigEndian: false, TrueColor: true,
		RedMax: 31, GreenMax: 63, BlueMax: 31,
		RedShift: 11, GreenShift: 5, BlueShift: 0,
	}
	// Pure white: B=255 G=255 R=255.
	src := []byte{255, 255, 255, 255}
	dst := make([]byte, 2)
	PackRow(dst, pf, src)

	got := binary.LittleEndian.Uint16(dst)
	want := uint16(31<<11 | 63<<5 | 31) // 0xFFFF for RGB565 white
	if got != want {
		t.Fatalf("packed 16bpp pixel = %#x, want %#x", got, want)
	}
}

func TestPackRow8bpp(t *testing.T) {
	pf := PixelFormat{
		BitsPerPixel: 8, Depth: 8, BigEndian: false, TrueColor: true,
		RedMax: 7, GreenMax: 7, BlueMax: 3,
		RedShift: 5, GreenShift: 2, BlueShift: 0,
	}
	src := []byte{255, 255, 255, 255} // white
	dst := make([]byte, 1)
	PackRow(dst, pf, src)

	want := byte(7<<5 | 7<<2 | 3)
	if dst[0] != want {
		t.Fatalf("packed 8bpp pixel = %#x, want %#x", dst[0], want)
	}
}

func TestPackRowMultiplePixels(t *testing.T) {
	pf := testPixelFormat()
	src := []byte{
		0x10, 0x20, 0x30, 0xFF,
		0x40, 0x50, 0x60, 0xFF,
		0x70, 0x80, 0x90, 0xFF,
	}
	dst := make([]byte, 12)
	PackRow(dst, pf, src)

	for i, wantRGB := range [][3]byte{{0x30, 0x20, 0x10}, {0x60, 0x50, 0x40}, {0x90, 0x80, 0x70}} {
		got := binary.LittleEndian.Uint32(dst[i*4 : i*4+4])
		want := uint32(wantRGB[0])<<16 | uint32(wantRGB[1])<<8 | uint32(wantRGB[2])
		if got != want {
			t.Fatalf("pixel %d = %#x, want %#x", i, got, want)
		}
	}
}

func TestIsIdentityBGRA32(t *testing.T) {
	if !isIdentityBGRA32(testPixelFormat()) {
		t.Fatal("testPixelFormat() should match the identity fast path -- it's the exact format real noVNC negotiates")
	}

	nonIdentity := []PixelFormat{
		{BitsPerPixel: 32, BigEndian: true, RedMax: 255, GreenMax: 255, BlueMax: 255, RedShift: 16, GreenShift: 8, BlueShift: 0},
		{BitsPerPixel: 16, RedMax: 31, GreenMax: 63, BlueMax: 31, RedShift: 11, GreenShift: 5, BlueShift: 0},
		{BitsPerPixel: 32, RedMax: 255, GreenMax: 255, BlueMax: 255, RedShift: 0, GreenShift: 8, BlueShift: 16}, // reversed shifts (BGR order)
	}
	for i, pf := range nonIdentity {
		if isIdentityBGRA32(pf) {
			t.Errorf("case %d: %+v incorrectly matched the identity fast path", i, pf)
		}
	}
}

// TestPackRowFastPathMatchesGeneralPath forces the general (non-fast-path)
// computation by hand for the identity format and confirms it produces the
// same R/G/B bytes as the real PackRow's fast path -- guards against the
// fast path silently drifting from what the general formula would have
// produced, for exactly the format real noVNC actually negotiates.
func TestPackRowFastPathMatchesGeneralPath(t *testing.T) {
	pf := testPixelFormat() // matches isIdentityBGRA32
	src := []byte{
		0x00, 0x00, 0x00, 0xFF,
		0xFF, 0xFF, 0xFF, 0x00,
		0x12, 0x34, 0x56, 0x78,
		0xAB, 0xCD, 0xEF, 0x99,
	}
	fast := make([]byte, len(src))
	PackRow(fast, pf, src)

	// Hand-compute the general per-pixel formula (mirrors the loop body
	// PackRow falls through to for any non-identity format) to confirm the
	// fast path's shortcut agrees with it pixel-for-pixel.
	general := make([]byte, len(src))
	for i := 0; i < len(src)/4; i++ {
		s := src[i*4 : i*4+4]
		b, g, r := uint32(s[0]), uint32(s[1]), uint32(s[2])
		pixel := (r << pf.RedShift) | (g << pf.GreenShift) | (b << pf.BlueShift)
		binary.LittleEndian.PutUint32(general[i*4:i*4+4], pixel)
	}

	if !bytes.Equal(fast, general) {
		t.Fatalf("fast path = %x, general formula = %x", fast, general)
	}
}

func TestNewCursorRectangleBasics(t *testing.T) {
	pixels := []byte{1, 2, 3, 4, 5, 6, 7, 8} // 2 fake pixels, arbitrary bytes
	rect := NewCursorRectangle(5, 7, 2, 1, pixels, func(col, row uint16) bool { return true })

	if rect.Encoding != EncodingCursorPseudo {
		t.Fatalf("Encoding = %d, want %d", rect.Encoding, EncodingCursorPseudo)
	}
	if rect.X != 5 || rect.Y != 7 || rect.W != 2 || rect.H != 1 {
		t.Fatalf("rect dims = %+v, want hotspot (5,7) size 2x1", rect)
	}
	// maskRowBytes = ceil(2/8) = 1, 1 row -> 1 mask byte appended after the
	// 8 pixel bytes.
	if len(rect.Pixels) != 8+1 {
		t.Fatalf("Pixels length = %d, want 9 (8 pixel bytes + 1 mask byte)", len(rect.Pixels))
	}
	if !bytes.Equal(rect.Pixels[:8], pixels) {
		t.Fatalf("pixel portion = %x, want %x", rect.Pixels[:8], pixels)
	}
	// Both columns opaque -> top two bits set (MSB-first): 1100 0000 = 0xC0.
	if rect.Pixels[8] != 0xC0 {
		t.Fatalf("mask byte = %#x, want 0xC0 (both columns opaque)", rect.Pixels[8])
	}
}

func TestNewCursorRectangleMaskBitPattern(t *testing.T) {
	// 3-wide cursor: only the middle column opaque. Width 3 needs
	// ceil(3/8)=1 mask byte per row -- confirms row padding to a whole
	// byte even when width isn't a multiple of 8.
	pixels := make([]byte, 3*4) // 3 pixels, arbitrary content
	rect := NewCursorRectangle(0, 0, 3, 1, pixels, func(col, row uint16) bool { return col == 1 })

	if len(rect.Pixels) != 12+1 {
		t.Fatalf("Pixels length = %d, want 13", len(rect.Pixels))
	}
	// MSB-first: col0->bit7, col1->bit6, col2->bit5. Only col1 opaque -> 0100 0000 = 0x40.
	if rect.Pixels[12] != 0x40 {
		t.Fatalf("mask byte = %#x, want 0x40 (only middle column opaque)", rect.Pixels[12])
	}
}

func TestNewCursorRectangleMultiRowMask(t *testing.T) {
	// 2 rows x 9 columns -> maskRowBytes = ceil(9/8) = 2 bytes/row, so this
	// also confirms multi-row indexing, not just single-row packing.
	w, h := uint16(9), uint16(2)
	pixels := make([]byte, int(w)*int(h)*4)
	// Row 0: column 8 opaque only. Row 1: column 0 opaque only.
	rect := NewCursorRectangle(0, 0, w, h, pixels, func(col, row uint16) bool {
		if row == 0 {
			return col == 8
		}
		return col == 0
	})

	maskRowBytes := 2
	if len(rect.Pixels) != int(w)*int(h)*4+maskRowBytes*int(h) {
		t.Fatalf("Pixels length = %d, want %d", len(rect.Pixels), int(w)*int(h)*4+maskRowBytes*int(h))
	}
	maskStart := int(w) * int(h) * 4
	row0 := rect.Pixels[maskStart : maskStart+2]
	row1 := rect.Pixels[maskStart+2 : maskStart+4]
	// Row 0: column 8 is the first bit of the second byte (MSB) -> 0x80.
	if row0[0] != 0x00 || row0[1] != 0x80 {
		t.Fatalf("row0 mask = %x, want [0x00 0x80]", row0)
	}
	// Row 1: column 0 is the first bit of the first byte (MSB) -> 0x80.
	if row1[0] != 0x80 || row1[1] != 0x00 {
		t.Fatalf("row1 mask = %x, want [0x80 0x00]", row1)
	}
}

func TestWriteFramebufferUpdateWithCursorRectangle(t *testing.T) {
	var buf bytes.Buffer
	pixels := []byte{1, 2, 3, 4}
	cursor := NewCursorRectangle(1, 2, 1, 1, pixels, func(col, row uint16) bool { return true })
	if err := WriteFramebufferUpdate(&buf, []Rectangle{cursor}); err != nil {
		t.Fatalf("WriteFramebufferUpdate: %v", err)
	}

	b := buf.Bytes()
	rectHdr := b[4:16]
	if binary.BigEndian.Uint16(rectHdr[0:2]) != 1 || binary.BigEndian.Uint16(rectHdr[2:4]) != 2 {
		t.Fatalf("hotspot = (%d,%d), want (1,2)", binary.BigEndian.Uint16(rectHdr[0:2]), binary.BigEndian.Uint16(rectHdr[2:4]))
	}
	gotEncoding := int32(binary.BigEndian.Uint32(rectHdr[8:12]))
	if gotEncoding != EncodingCursorPseudo {
		t.Fatalf("encoding = %d, want %d (EncodingCursorPseudo)", gotEncoding, EncodingCursorPseudo)
	}
	// 4 pixel bytes + 1 mask byte (ceil(1/8)=1 row byte * 1 row).
	if len(b[16:]) != 5 {
		t.Fatalf("payload length = %d, want 5", len(b[16:]))
	}
}
