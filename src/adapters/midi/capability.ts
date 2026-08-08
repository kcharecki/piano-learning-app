/**
 * Whether this browser can expose a MIDI keyboard at all (roadmap 5.6). Pure
 * feature detection, deliberately separate from `createWebMidi`'s connection
 * attempt: this must answer synchronously, before any permission prompt, so
 * `InputCapabilityBanner` can render on first paint. iOS/iPadOS WebKit has no
 * Web MIDI in any browser shell (see B.7) — this is `false` there regardless
 * of a real keyboard being plugged in.
 */
export function isWebMidiSupported(nav: { requestMIDIAccess?: unknown } | undefined = undefined): boolean {
  const target = nav ?? (typeof navigator === 'undefined' ? undefined : navigator)
  return typeof target?.requestMIDIAccess === 'function'
}
