/**
 * Shared chord/scale audio and root-picker helpers for `ChordScaleReference.tsx`
 * and `ChordLookup.tsx` (roadmap 3.15a).
 *
 * Both screens used to carry their own copy of: the lazily-created shared
 * `AudioOutput` accessor, `playChordTones`, `ROOT_OPTIONS`, `noteLabel`,
 * `CHORD_DURATION_MS` and `PLAY_VELOCITY` — `ChordLookup.tsx`'s own module
 * comment said as much ("a deliberate line-for-line mirror... duplicated
 * rather than imported... left as a known follow-up"). `playScaleAscending`
 * only ever lived in `ChordScaleReference.tsx`, but is hoisted here too so
 * both screens' playback helpers live in one leaf module. This is a pure
 * extraction: every function's body is unchanged from whichever file it came
 * from, so behaviour — exact pitches, exact timestamps, a note-off per
 * note-on, an audible velocity — is unchanged (see the two components' own
 * playback test suites).
 *
 * The one thing NOT hoisted here is either component's panic-on-change
 * `useEffect`: `ChordScaleReference`'s panics unconditionally on every
 * root/scaleType/seventh/audioOutput change, while `ChordLookup`'s only
 * panics when *it* actually started a performance (`ringingRef` — see that
 * file's own comment on why: an unconditional panic on the shared
 * `AudioContext` would silence a still-playing scale in the reference above
 * it). That gating difference means the two effects are not actually
 * identical, so unifying them behind one hook would either lose the gate or
 * force it onto a caller that doesn't need it — a behaviour change either
 * way, which this extraction must not make. `stopRingingAudio` below hoists
 * the one line that genuinely is identical (resolve the existing output and
 * cancel it) and each component still wires it into its own `useEffect` with
 * its own dependency list and its own gate.
 */
import { useRef } from 'react'
import type { RefObject } from 'react'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import type { AudioOutput } from '@core/ports/audio.ts'
import { midi, millis } from '@core/shared/units.ts'
import { fromMidi, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'

/** Spacing between consecutive scale notes, and how long each rings, in ms. */
export const SCALE_NOTE_SPACING_MS = 400
export const SCALE_NOTE_DURATION_MS = 350
/** How long a played chord rings, in ms. */
export const CHORD_DURATION_MS = 800
/** Neither soft nor pinned to max — an audible, unremarkable press. */
export const PLAY_VELOCITY = 80

/**
 * Play a scale ascending, one note after another at a fixed spacing —
 * REQ-3.5.3's "hear them". Every note's `atMs` is derived from one
 * `audioOutput.now()` reading plus its own fixed offset, never a fresh clock
 * read per note.
 *
 * `allNotesOff()` first: without it, a second press while the first
 * performance is still ringing stacks its notes on top rather than
 * restarting, and changing the root/scale mid-performance lets the old scale
 * finish playing under the new selection on screen. The caller's own
 * panic-on-change cleanup effect covers the other two triggers — root/type
 * change and unmount — that a press-time panic alone cannot.
 */
export function playScaleAscending(audioOutput: AudioOutput, notes: readonly SpelledPitch[]): void {
  audioOutput.allNotesOff()
  const base = audioOutput.now()
  notes.forEach((note, i) => {
    const noteMidi = toMidi(note)
    const onMs = millis(base + i * SCALE_NOTE_SPACING_MS)
    const offMs = millis(base + i * SCALE_NOTE_SPACING_MS + SCALE_NOTE_DURATION_MS)
    audioOutput.noteOn(noteMidi, PLAY_VELOCITY, onMs)
    audioOutput.noteOff(noteMidi, offMs)
  })
}

/**
 * Play a chord as a simultaneity — every tone at the exact same instant —
 * REQ-3.5.4's "hear it". Unlike `playScaleAscending`, every tone shares one
 * `atMs`, so it sounds as a chord rather than an arpeggio.
 */
export function playChordTones(audioOutput: AudioOutput, tones: readonly SpelledPitch[]): void {
  audioOutput.allNotesOff()
  const base = audioOutput.now()
  const onMs = millis(base)
  const offMs = millis(base + CHORD_DURATION_MS)
  for (const tone of tones) {
    const noteMidi = toMidi(tone)
    audioOutput.noteOn(noteMidi, PLAY_VELOCITY, onMs)
    audioOutput.noteOff(noteMidi, offMs)
  }
}

/** Pitch classes that are conventionally written flat rather than sharp (Bb, Eb, Ab, Db). */
const FLAT_PITCH_CLASSES: ReadonlySet<number> = new Set([1, 3, 8, 10])

/**
 * Twelve pitch classes for a root picker, each spelled the way a learner
 * actually writes it — sharp for C#/F#/G#, flat for Db/Eb/Ab/Bb — so every
 * offered root names a writable key.
 */
export const ROOT_OPTIONS: readonly SpelledPitch[] = Array.from({ length: 12 }, (_, pc) =>
  fromMidi(midi(pc + 60), FLAT_PITCH_CLASSES.has(pc)),
)

/** `'C#'`, `'Bb'` — a root option's name with no octave. */
export function noteLabel(p: SpelledPitch): string {
  const sign = p.alter < 0 ? 'b'.repeat(-p.alter) : '#'.repeat(p.alter)
  return `${p.letter}${sign}`
}

/**
 * Lazily-created shared `AudioOutput` accessor: with no `audioOutput`
 * argument, the real Web Audio output is built on the first call, inside
 * that call's click handler — never at mount — because the browser's
 * autoplay policy requires the `AudioContext` be created inside a user
 * gesture (see `createDefaultAudioOutput`'s own doc). Returns the same
 * accessor function and the backing ref every render; call the returned
 * `getAudioOutput` inside an event handler, and pass the returned `audioRef`
 * to `stopRingingAudio` from a cleanup effect.
 *
 * The injected `audioOutput` argument is read directly on every call rather
 * than only seeding the ref at first render, so a caller that mounts with it
 * `undefined` and supplies a real value later switches to the caller's
 * injected one instead of silently keeping a real `AudioContext` it built
 * for itself.
 */
export function useSharedAudioOutput(audioOutput: AudioOutput | undefined): {
  readonly audioRef: RefObject<AudioOutput | undefined>
  readonly getAudioOutput: () => AudioOutput
} {
  const audioRef = useRef<AudioOutput | undefined>(undefined)
  function getAudioOutput(): AudioOutput {
    if (audioOutput !== undefined) return audioOutput
    if (audioRef.current === undefined) {
      audioRef.current = createDefaultAudioOutput()
    }
    return audioRef.current
  }
  return { audioRef, getAudioOutput }
}

/**
 * Cancels whatever the shared output built by {@link useSharedAudioOutput} is
 * still ringing, without force-constructing it: resolves to the injected
 * `audioOutput` prop if there is one, else whatever the lazy ref already
 * holds (never `getAudioOutput()`, which would construct a real
 * `AudioContext` outside a user gesture). Only the one line every panic
 * cleanup effect shares — each caller still owns its own `useEffect`, its own
 * dependency list, and (for `ChordLookup`) its own gate on whether it is the
 * one that actually started the ringing performance; see this module's own
 * comment for why that gate is not hoisted here too.
 */
export function stopRingingAudio(
  audioOutput: AudioOutput | undefined,
  audioRef: RefObject<AudioOutput | undefined>,
): void {
  const existing = audioOutput ?? audioRef.current
  existing?.allNotesOff()
}
