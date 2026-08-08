/**
 * States the QWERTY note mapping on screen (roadmap 5.5) — silent support for
 * a second input is the same "reads as broken, not limited" failure roadmap
 * 5.6 names for missing MIDI, so the mapping is shown here rather than left
 * to a doc only a developer reads.
 */
import { QWERTY_BLACK_KEYS, QWERTY_WHITE_KEYS } from './useQwertyNoteInput.ts'

export function QwertyHint() {
  return (
    <p className="qwerty-hint">
      Or type it — <kbd>A</kbd> is the lowest key shown:{' '}
      {QWERTY_WHITE_KEYS.map((k) => (
        <kbd key={`w-${k}`}>{k}</kbd>
      ))}{' '}
      play the white keys,{' '}
      {QWERTY_BLACK_KEYS.map((k) => (
        <kbd key={`b-${k}`}>{k}</kbd>
      ))}{' '}
      the black keys.
    </p>
  )
}
