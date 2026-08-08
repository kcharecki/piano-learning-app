/**
 * How many keys the practice screen's on-screen piano draws (roadmap 5.4).
 *
 * Its own module rather than a second export from `PracticeKeyboard.tsx`,
 * which the react-refresh lint correctly refuses: a file that exports both a
 * component and a plain function breaks fast refresh.
 */
import { pitchRange, type Score } from '@core/notation/score.ts'
import { PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, midi as asMidi, type Midi } from '@core/shared/units.ts'

/** Fewer keys than this and the keyboard reads as a fragment rather than a piano. */
const MIN_KEYS = 25
/**
 * Default span when nothing is loaded, or the score has no notes at all: C3–B5,
 * three octaves around middle C. Already on octave boundaries, so the widening
 * below is a no-op on it.
 */
const DEFAULT_LOW = 48
const DEFAULT_HIGH = 83

/**
 * The span to draw for a score: its own pitch range, widened out to whole
 * octaves (C at the bottom, B at the top) so the keyboard has the shape of a
 * piano rather than starting mid-octave, and then to `MIN_KEYS` if the piece
 * is narrower than that. Clamped to a real 88-key instrument at both ends.
 *
 * All 88 keys would be unplayable at any width; a fixed guessed range would
 * leave the loaded piece's own notes off the end of it.
 */
export function keyboardRangeFor(score: Score | undefined): {
  readonly low: Midi
  readonly high: Midi
} {
  const range = score === undefined ? undefined : pitchRange(score)
  const rawLow = range?.low ?? DEFAULT_LOW
  const rawHigh = range?.high ?? DEFAULT_HIGH

  // Down to the C at or below the lowest note, up to the B at or above the
  // highest — `+ 1` because a B is one below the next C.
  let low = Math.floor(rawLow / 12) * 12
  let high = Math.ceil((rawHigh + 1) / 12) * 12 - 1

  // Widen, an octave at a time and downward first (the left hand is what a
  // narrow range usually clips), until there are enough keys to play on.
  while (high - low + 1 < MIN_KEYS) {
    if (low - 12 >= PIANO_LOWEST_MIDI) low -= 12
    else if (high + 12 <= PIANO_HIGHEST_MIDI) high += 12
    else break
  }

  return {
    low: asMidi(Math.max(PIANO_LOWEST_MIDI, low)),
    high: asMidi(Math.min(PIANO_HIGHEST_MIDI, high)),
  }
}
