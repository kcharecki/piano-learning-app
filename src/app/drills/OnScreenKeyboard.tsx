/**
 * An unlabelled on-screen keyboard (roadmap 2.12, REQ-3.4.5) — the fallback
 * answer input for a flashcard when there is no physical MIDI keyboard
 * connected. Deliberately unlabelled: a real piano does not print note names
 * on its keys, and a flashcard that asked "which key is this note" while
 * printing the letter on every button would not be testing anything.
 */
import {
  PIANO_HIGHEST_MIDI,
  PIANO_LOWEST_MIDI,
  type Midi,
  midi as asMidi,
} from '@core/shared/units.ts'

export type OnScreenKeyboardProps = {
  readonly low: Midi
  readonly high: Midi
  readonly onPress: (note: Midi) => void
  readonly disabled?: boolean
}

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

function isBlackKey(note: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

export function OnScreenKeyboard({ low, high, onPress, disabled = false }: OnScreenKeyboardProps) {
  const clampedLow = Math.max(PIANO_LOWEST_MIDI, low)
  const clampedHigh = Math.min(PIANO_HIGHEST_MIDI, high)
  const notes: number[] = []
  for (let n = clampedLow; n <= clampedHigh; n++) notes.push(n)

  return (
    <div className="keyboard-diagram" role="group" aria-label="On-screen keyboard">
      {notes.map((note) => (
        <button
          key={note}
          type="button"
          className={isBlackKey(note) ? 'key key-black' : 'key key-white'}
          aria-label={`Key ${note}`}
          disabled={disabled}
          onClick={() => onPress(asMidi(note))}
        />
      ))}
    </div>
  )
}
