/**
 * Maps a `getUserMedia()` rejection to learner-safe, actionable copy — the
 * `audioRecorder.ts`/`micPitchInput.ts` sibling of `webmidi.ts`'s
 * `requestMIDIAccess` handling (`createWebMidi`'s catch block). Same shape:
 * the raw browser exception is logged for a developer via `console.warn`,
 * never interpolated into copy a learner sees, and the genuinely different
 * cases — no microphone present, the microphone already in use, permission
 * refused — stay distinct rather than collapsing into one generic string a
 * caller would otherwise have to parse apart from a raw `Error#message`.
 */
export function describeMicError(context: string, cause: unknown): string {
  console.warn(`[${context}] getUserMedia failed:`, cause)
  const name = cause instanceof DOMException ? cause.name : undefined
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Connect one and try again.'
  }
  if (name === 'NotReadableError') {
    return 'The microphone is already in use by another app. Close it and try again.'
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "This browser blocked microphone access. Allow it in the browser's site settings, then reload the page."
  }
  return "Microphone access failed. Check your microphone's connection and try again."
}
