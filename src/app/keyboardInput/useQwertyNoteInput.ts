/**
 * Wires the fixed QWERTY note mapping (`qwertyNoteMap.ts`) to a window-level
 * `keydown`/`keyup` listener (roadmap 5.5) — the second, always-available
 * input every note-answered screen needed, alongside MIDI and the on-screen
 * keyboard.
 *
 * Presses through `onPress`/`onRelease` exactly like `OnScreenKeyboard` does,
 * so on the practice screen a typed note enters `PlayableMidiInput` (the same
 * seam a hardware keyboard and a click feed) and is graded by the real
 * matcher. On the click-only drill screens (`onRelease` absent) a keydown is
 * simply one answer, matching what a click already means there.
 *
 * `event.repeat` is what a HELD physical key sends on autorepeat — ignoring
 * it, and tracking down keys by `event.code` until their matching `keyup`,
 * is what stops a doubled note-on from reaching the matcher as an extra note
 * (the same failure mode `playableInput.ts`'s `press` guards against).
 */
import type { Midi } from '@core/shared/units.ts'
import { useEffect, useRef } from 'react'
import { noteForCode } from './qwertyNoteMap.ts'

export type UseQwertyNoteInputOptions = {
  /** Off entirely when false — no listeners are attached. */
  readonly enabled: boolean
  readonly low: Midi
  readonly high: Midi
  /** What `KeyA` plays; see `defaultBaseNote`. */
  readonly baseNote: Midi
  readonly onPress: (note: Midi) => void
  /** Absent means click-semantics: a keydown answers once, nothing is held. */
  readonly onRelease?: (note: Midi) => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** The mapping's own physical footprint, for a caller that wants to render it. */
export const QWERTY_WHITE_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';']
export const QWERTY_BLACK_KEYS = ['W', 'E', 'T', 'Y', 'U', 'O', 'P']

export function useQwertyNoteInput({
  enabled,
  low,
  high,
  baseNote,
  onPress,
  onRelease,
}: UseQwertyNoteInputOptions): void {
  // A ref, not a dependency: re-subscribing window listeners on every render
  // (the range/callbacks change often — e.g. a new score, a new flashcard)
  // would drop whatever `keyup` a listener swap raced with, stranding a note
  // as "held" forever. The listeners below always read the LATEST values here.
  const latestRef = useRef({ low, high, baseNote, onPress, onRelease })
  latestRef.current = { low, high, baseNote, onPress, onRelease }
  const downRef = useRef<Map<string, Midi>>(new Map())

  useEffect(() => {
    if (!enabled) return undefined

    const releaseAll = (): void => {
      const { onRelease } = latestRef.current
      for (const note of downRef.current.values()) onRelease?.(note)
      downRef.current.clear()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (downRef.current.has(event.code)) return
      const { low, high, baseNote, onPress } = latestRef.current
      const note = noteForCode(event.code, baseNote)
      if (note === undefined || note < low || note > high) return
      downRef.current.set(event.code, note)
      onPress(note)
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      const note = downRef.current.get(event.code)
      if (note === undefined) return
      downRef.current.delete(event.code)
      latestRef.current.onRelease?.(note)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    // Alt-tabbing away mid-hold sends no keyup — without this the note plays
    // forever, the same stuck-note failure `PlayableInput.dispose` guards.
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseAll)
      releaseAll()
    }
  }, [enabled])
}
