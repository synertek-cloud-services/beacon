// Minimal ambient typing for @novnc/novnc -- the package ships no .d.ts of
// its own (confirmed: npm-published files are core/*.js only). Only the
// constructor/methods WebRemotePage.vue actually calls are declared; see
// node_modules/@novnc/novnc/docs/API.md for the full surface if more is
// needed later.
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: Element, urlOrChannel: string, options?: Record<string, unknown>);
    // Real settable properties (API.md's "Properties" section), NOT
    // constructor options -- the constructor only reads
    // credentials/shared/repeaterID/wsProtocols from its third argument.
    // Must be assigned on the instance after construction to actually take
    // effect (each has a setter with a real side effect internally).
    scaleViewport: boolean;
    clipViewport: boolean;
    sendCtrlAltDel(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
    disconnect(): void;
  }
}
