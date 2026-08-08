/**
 * The practice screen's on-screen piano (roadmap 5.4, REQ-3.3.7).
 *
 * ## Why it is here at all
 *
 * `PracticeScreen` took a MIDI device and nothing else. Without Web MIDI —
 * Safari, Firefox, and every browser on iPadOS, which are all WebKit
 * underneath (roadmap B.7) — matching, feedback colouring, wait mode,
 * assessment, timing feedback, recording and the tempo ramp were all inert on
 * the one screen where playing is the point, while Flashcards, Theory and
 * Dictation had rendered a keyboard all along. Notes clicked here go through
 * `createPlayableInput`, i.e. the same `MidiInput` seam a hardware keyboard
 * feeds, so they are graded by the real matcher rather than by a parallel path.
 *
 * ## What it shows, and what it costs the screen
 *
 * The keyboard is placed directly under the engraving — where the hands go,
 * and above the setup controls — rather than as another entry in the control
 * column, which roadmap 5.17/5.18 already record as too dense (30 controls in
 * 13 groups). It adds exactly ONE control: a checkbox, on by default when
 * there is no device and off when there is, so a learner with a real keyboard
 * pays nothing for this and one without it needs no setup step. The sticky
 * transport strip stays the screen's primary surface, untouched.
 *
 * It spans the loaded piece's own pitch range rather than all 88 keys (which
 * is unplayable at any width) or a fixed guess (which would leave the piece's
 * own notes off the end of it) — see `keyboardRangeFor`.
 */
import { OnScreenKeyboard } from '@app/drills/OnScreenKeyboard.tsx'
import { QwertyHint } from '@app/keyboardInput/QwertyHint.tsx'
import { defaultBaseNote } from '@app/keyboardInput/qwertyNoteMap.ts'
import { useQwertyNoteInput } from '@app/keyboardInput/useQwertyNoteInput.ts'
import type { Score } from '@core/notation/score.ts'
import type { Midi } from '@core/shared/units.ts'
import { keyboardRangeFor } from './keyboardRange.ts'

export type PracticeKeyboardProps = {
  readonly score: Score | undefined
  readonly onPress: (note: Midi) => void
  readonly onRelease: (note: Midi) => void
  /** Is a real MIDI keyboard connected? Drives the explanatory line only. */
  readonly deviceConnected: boolean
  readonly visible: boolean
  readonly onVisibleChange: (visible: boolean) => void
  readonly latch: boolean
  readonly onLatchChange: (latch: boolean) => void
  readonly disabled?: boolean
}

export function PracticeKeyboard({
  score,
  onPress,
  onRelease,
  deviceConnected,
  visible,
  onVisibleChange,
  latch,
  onLatchChange,
  disabled = false,
}: PracticeKeyboardProps) {
  const { low, high } = keyboardRangeFor(score)

  // Same seam the on-screen keyboard presses through (roadmap 5.5) — a typed
  // note enters `playableInput` exactly like a click or a MIDI key would.
  useQwertyNoteInput({
    enabled: visible && !disabled,
    low,
    high,
    baseNote: defaultBaseNote(low, high),
    onPress,
    onRelease,
  })

  return (
    <section className="practice-keyboard" aria-label="On-screen keyboard">
      <div className="practice-keyboard-toggles">
        <label className="practice-keyboard-toggle">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => onVisibleChange(event.target.checked)}
          />
          On-screen keyboard
        </label>
        {/* A mouse has one pointer, so without this every chord in the piece is
            unplayable — including the bundled sample's very first beat, which
            is four notes, and which wait mode will hold the transport on until
            all four are down AT ONCE (`core/practice/waitmode.ts`). Off by
            default: with touch or MIDI, momentary keys are the honest ones. */}
        {visible && (
          <label className="practice-keyboard-toggle">
            <input
              type="checkbox"
              checked={latch}
              onChange={(event) => onLatchChange(event.target.checked)}
            />
            Hold keys down (for chords)
          </label>
        )}
      </div>
      {/* Shown only when this keyboard is the learner's ONLY way to play; with
          a device connected it is a convenience and needs no explanation.
          Deliberately does NOT repeat "no MIDI keyboard connected" —
          `MidiDeviceStatus` says that, three inches up the same screen, and
          saying it twice is the kind of duplication docs/DESIGN.md rule 3
          exists to stop. This says the thing that status line does not: that
          playing here counts. */}
      {!deviceConnected && (
        <p className="practice-keyboard-hint">
          Play the notes here — they are graded exactly as a MIDI keyboard would be.
        </p>
      )}
      {visible && (
        <OnScreenKeyboard
          low={low}
          high={high}
          onPress={onPress}
          onRelease={onRelease}
          latch={latch}
          disabled={disabled}
          label="Play the score"
        />
      )}
      {visible && !disabled && <QwertyHint />}
    </section>
  )
}
