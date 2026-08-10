/**
 * Turns a per-frame stream of `detectPitch` results into discrete note
 * on/off decisions (roadmap 5.7 / B.1). Pure state machine — no `Clock`, no
 * DOM: `adapters/audio/micPitchInput.ts` feeds it one frame at a time and
 * attaches real timestamps to the events it returns.
 *
 * A raw pitch-detector frame is noisy on both ends of a note: onset (the
 * struck-string transient before the pitch settles) and release (a decaying
 * tail that reads as periodic-but-quiet, or a stray reflected harmonic,
 * after the finger lifts). Firing a `MidiEvent` on every frame would spam
 * the matcher with flicker; this module requires a detection to hold for
 * `onsetFrames` consecutive frames before it becomes a note-on, and requires
 * `releaseFrames` consecutive silent-or-different frames before the held
 * note turns off — the same debounce shape a physical key's contact bounce
 * would need, just in pitch-space instead of a switch.
 */
import { frequencyToMidi, nearestNote, type PitchDetectionResult } from './pitchDetection.ts'

export type NoteOnsetEvent =
  | { readonly type: 'on'; readonly note: number }
  | { readonly type: 'off'; readonly note: number }

export type OnsetDetectorState = {
  readonly heldNote: number | null
  readonly candidateNote: number | null
  readonly candidateFrames: number
  readonly silentFrames: number
}

export const initialOnsetState: OnsetDetectorState = {
  heldNote: null,
  candidateNote: null,
  candidateFrames: 0,
  silentFrames: 0,
}

export type OnsetConfig = {
  /** A frame below this clarity is treated the same as silence. */
  readonly minClarity: number
  /** Consecutive matching frames required before a candidate note fires 'on'. */
  readonly onsetFrames: number
  /** Consecutive silent/mismatched frames required before a held note fires 'off'. */
  readonly releaseFrames: number
  /** A detected pitch further than this from the nearest semitone is not a note at all — vibrato or a bend-in-progress. */
  readonly maxCentsOff: number
}

export const DEFAULT_ONSET_CONFIG: OnsetConfig = {
  minClarity: 0.85,
  onsetFrames: 3,
  releaseFrames: 6,
  maxCentsOff: 45,
}

/** One tick of the detector: feed it the current frame's `detectPitch` result (or `null` for silence), get back the possibly-updated state and any events this frame produced. */
export function stepOnsetDetector(
  state: OnsetDetectorState,
  sample: PitchDetectionResult | null,
  config: OnsetConfig = DEFAULT_ONSET_CONFIG,
): { readonly state: OnsetDetectorState; readonly events: readonly NoteOnsetEvent[] } {
  const detected =
    sample !== null && sample.clarity >= config.minClarity
      ? nearestNote(frequencyToMidi(sample.frequencyHz))
      : null
  const isValid = detected !== null && Math.abs(detected.centsOff) <= config.maxCentsOff

  if (!isValid) {
    if (state.heldNote === null) {
      return { state: { ...state, candidateNote: null, candidateFrames: 0 }, events: [] }
    }
    const silentFrames = state.silentFrames + 1
    if (silentFrames >= config.releaseFrames) {
      return {
        state: { heldNote: null, candidateNote: null, candidateFrames: 0, silentFrames: 0 },
        events: [{ type: 'off', note: state.heldNote }],
      }
    }
    return {
      state: { ...state, candidateNote: null, candidateFrames: 0, silentFrames },
      events: [],
    }
  }

  const note = detected.note
  if (state.heldNote === note) {
    return {
      state: { ...state, candidateNote: null, candidateFrames: 0, silentFrames: 0 },
      events: [],
    }
  }

  const candidateFrames = state.candidateNote === note ? state.candidateFrames + 1 : 1
  if (candidateFrames < config.onsetFrames) {
    return {
      state: { ...state, candidateNote: note, candidateFrames, silentFrames: 0 },
      events: [],
    }
  }

  const events: NoteOnsetEvent[] = []
  if (state.heldNote !== null) events.push({ type: 'off', note: state.heldNote })
  events.push({ type: 'on', note })
  return {
    state: { heldNote: note, candidateNote: null, candidateFrames: 0, silentFrames: 0 },
    events,
  }
}
