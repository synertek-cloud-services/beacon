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
