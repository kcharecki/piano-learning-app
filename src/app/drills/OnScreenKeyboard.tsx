/**
 * An unlabelled on-screen keyboard (roadmap 2.12, REQ-3.4.5) — the fallback
 * answer input for a flashcard when there is no physical MIDI keyboard
 * connected. Deliberately unlabelled: a real piano does not print note names
 * on its keys, and a flashcard that asked "which key is this note" while
 * printing the letter on every button would not be testing anything.
 *
 * ## Two input modes, and why (roadmap 5.4)
 *
 * A drill asks "which note is this" and only ever needs the ANSWER — one
 * `onPress` per key, on click, which is what the three drill screens
 * (`FlashcardScreen`, `DictationAnswerPad`, `TheoryDrillPanel`) use.
 *
 * The practice screen needs something stronger: `core/practice/waitmode.ts`
 * gates the transport on the required notes being held — its own comment is
 * "…and the key must still be down. `noteOff` withdraws the credit", so
 * `requireAllChordNotes` really does mean every note down at once — and a key
 * that pressed and released in the same instant would never advance a bar.
 * Passing `onRelease` switches this component to real press/release on pointer
 * (and Enter/Space) down and up, and marks the held keys with
 * `data-state="pressed"`, which the design system already styles.
 *
 * The click path is kept, rather than pointer events being made unconditional,
 * so that the drill screens' behaviour and their tests are untouched by a
 * change made for a different screen.
 *
 * ## `latch`, and why a chord needs it
 *
 * A mouse has ONE pointer. Momentary keys therefore make every chord in the
 * piece unplayable — the bundled sample's very first beat is a four-note
 * chord, so a mouse-only learner would sit at a wait-mode barrier forever.
 * `latch` makes a press toggle instead: down stays down until that key is
 * pressed again, so a chord can be assembled one click at a time. Touch and
 * MIDI users do not need it, which is why it is a choice and not the default.
 */
import {
  PIANO_HIGHEST_MIDI,
  PIANO_LOWEST_MIDI,
  type Midi,
  midi as asMidi,
} from '@core/shared/units.ts'
import { useCallback, useEffect, useRef, useState } from 'react'

export type OnScreenKeyboardProps = {
  readonly low: Midi
  readonly high: Midi
  readonly onPress: (note: Midi) => void
  /**
   * When given, keys press on pointer/key DOWN and release on UP — the mode
   * the practice screen needs. When absent, keys fire `onPress` on click and
   * nothing is ever held, which is what the drill screens want.
   */
  readonly onRelease?: (note: Midi) => void
  /**
   * Press toggles instead of being momentary, so a single pointer can hold a
   * chord. Only meaningful alongside `onRelease`.
   */
  readonly latch?: boolean
  readonly disabled?: boolean
  /** Overrides the group's accessible name. Defaults to "On-screen keyboard". */
  readonly label?: string
}

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

function isBlackKey(note: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

/** Enter and Space are what a `<button>` activates on; nothing else holds a key. */
function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}

export function OnScreenKeyboard({
  low,
  high,
  onPress,
  onRelease,
  latch = false,
  disabled = false,
  label = 'On-screen keyboard',
}: OnScreenKeyboardProps) {
  const clampedLow = Math.max(PIANO_LOWEST_MIDI, low)
  const clampedHigh = Math.min(PIANO_HIGHEST_MIDI, high)
  const notes: number[] = []
  for (let n = clampedLow; n <= clampedHigh; n++) notes.push(n)

  // Which keys look down. The authority is `heldRef`, not the state: the
  // callbacks below must decide "is this key already down" and call
  // `onPress`/`onRelease` OUTSIDE a state updater. Doing that work inside a
  // `setHeld(current => …)` updater runs it during render, and the callbacks
  // reach `PracticeScreen`'s note pipeline — React's
  // "Cannot update a component while rendering a different component" warning,
  // observed in the browser before this was split.
  const heldRef = useRef<Set<number>>(new Set())
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set())

  const press = useCallback(
    (note: number): void => {
      // A pointerdown on an already-held key (autorepeat on Enter, a second
      // pointer on the same key) must not fire a second `onPress`: the matcher
      // would score it as an extra note.
      if (heldRef.current.has(note)) return
      heldRef.current.add(note)
      setHeld(new Set(heldRef.current))
      onPress(asMidi(note))
    },
    [onPress],
  )

  const release = useCallback(
    (note: number): void => {
      if (!heldRef.current.delete(note)) return
      setHeld(new Set(heldRef.current))
      onRelease?.(asMidi(note))
    },
    [onRelease],
  )

  // Leaving (or entering) latch mode must not strand a key down: the caller
  // would go on being told it is held — wait mode credits a pitch only while
  // its key is down — and it would go on being drawn pressed. Released through
  // the normal `release` path so both sides move together.
  const releaseAllRef = useRef<() => void>(() => {})
  releaseAllRef.current = (): void => {
    for (const note of [...heldRef.current]) release(note)
  }
  useEffect(() => {
    return () => releaseAllRef.current()
  }, [latch])

  /** Latched keys toggle; momentary keys go down here and up on pointerup. */
  const activate = useCallback(
    (note: number): void => {
      if (latch && heldRef.current.has(note)) release(note)
      else press(note)
    },
    [latch, press, release],
  )

  const pressReleaseMode = onRelease !== undefined

  return (
    <div className="keyboard-diagram" role="group" aria-label={label}>
      {notes.map((note) => (
        <button
          key={note}
          type="button"
          className={isBlackKey(note) ? 'key key-black' : 'key key-white'}
          aria-label={`Key ${note}`}
          disabled={disabled}
          {...(held.has(note) ? { 'data-state': 'pressed' } : {})}
          {...(pressReleaseMode
            ? {
                onPointerDown: (event) => {
                  // Keep receiving the pointerup even if the finger slides off
                  // the key, so a note cannot be left sounding forever. Guarded
                  // because a synthetic pointer event (a test dispatching
                  // `pointerdown` directly) carries no live pointer id, and
                  // `setPointerCapture` throws on one.
                  try {
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                  } catch {
                    /* no capture available — momentary keys still work */
                  }
                  activate(note)
                },
                ...(latch
                  ? {}
                  : {
                      onPointerUp: () => release(note),
                      onPointerCancel: () => release(note),
                      onBlur: () => release(note),
                    }),
                onKeyDown: (event) => {
                  if (!isActivationKey(event.key)) return
                  // A held Enter autorepeats; `press` already ignores a repeat,
                  // and this stops the browser also synthesising a click.
                  event.preventDefault()
                  activate(note)
                },
                ...(latch
                  ? {}
                  : {
                      onKeyUp: (event) => {
                        if (!isActivationKey(event.key)) return
                        release(note)
                      },
                    }),
              }
            : { onClick: () => onPress(asMidi(note)) })}
        />
      ))}
    </div>
  )
}
