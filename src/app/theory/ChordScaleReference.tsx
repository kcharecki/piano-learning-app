/**
 * The chord & scale reference (roadmap 3.9/3.13, REQ-3.5.3/3.5.4): "always
 * available" — pick any root and scale type, see the scale's notes, degree
 * names and recommended fingering, and the seven diatonic chords of that key
 * with their roman numerals, symbols, figured bass and notes on the
 * keyboard — and now *hear* both: a "Play {scale} scale" control plays the
 * looked-up scale ascending, one note after another, and each chord row's own
 * "Play the {numeral} chord" control plays that chord as a simultaneity (all
 * tones at once) — REQ-3.5.3/3.5.4's "hear them"/"hear it", which nothing in
 * this file did before (see the roadmap-3.13 finding: grepping this directory
 * for audio turned up nothing).
 *
 * A controlled component: `root`/`scaleType` and their `onChange` callbacks
 * are owned by the caller (`TheoryScreen`), so the circle of fifths can drive
 * this reference by changing `root`/`scaleType` from outside, while the
 * reference's own pickers call the same callbacks — one source of truth,
 * matching the roadmap's "circle's selection driving the reference below it".
 *
 * All music facts — the scale's notes, its fingering, the diatonic chords and
 * their roman numerals — come from `@core/theory/*`; this file only lays them
 * out.
 *
 * ## Playback
 *
 * Both play paths go through the injected `AudioOutput` port, never straight
 * to Web Audio — same discipline as `useEarTraining`'s `scheduleItem`. The
 * scale schedules every note from a single `audioOutput.now()` reading plus a
 * fixed per-note offset (`SCALE_NOTE_SPACING_MS`), so it sounds ascending, one
 * note after another; a chord schedules every tone at that same one reading,
 * with no per-tone offset, so it sounds as a simultaneity rather than an
 * arpeggio. With no `audioOutput` prop the real `AudioOutput` is built lazily
 * on the first press, inside that press's click handler — never at mount —
 * because the browser's autoplay policy requires the `AudioContext` be
 * created inside a user gesture (see `createDefaultAudioOutput`'s own doc).
 */
import { useEffect, useRef } from 'react'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import type { AudioOutput } from '@core/ports/audio.ts'
import { at } from '@core/shared/invariant.ts'
import { midi, millis } from '@core/shared/units.ts'
import { chordSymbol, chordTones, figuredBass, type Chord } from '@core/theory/chords.ts'
import { chordForRomanNumeral, diatonicChords, romanNumeralFor } from '@core/theory/harmony.ts'
import { keyOf, type Key, type Mode } from '@core/theory/keys.ts'
import {
  fromMidi,
  pitchName,
  type SpelledPitch,
  spelledPitchClass,
  toMidi,
} from '@core/theory/pitch.ts'
import {
  buildScale,
  degreeName,
  scaleFingering,
  scaleName,
  scaleNotes,
  SCALE_TYPES,
  type ScaleType,
} from '@core/theory/scales.ts'
import { KeyboardDiagram } from './KeyboardDiagram.tsx'

export type ChordScaleReferenceProps = {
  readonly root: SpelledPitch
  readonly scaleType: ScaleType
  readonly onRootChange: (root: SpelledPitch) => void
  readonly onScaleTypeChange: (type: ScaleType) => void
  /** Injection seam for tests; defaults to the real Web Audio output, built
   *  lazily on first press so the AudioContext is created inside a user
   *  gesture (the browser autoplay policy requires it — see
   *  `@app/practice/createDefaultAudioOutput.ts`, which you may import). */
  readonly audioOutput?: AudioOutput
}

/** Spacing between consecutive scale notes, and how long each rings, in ms. */
const SCALE_NOTE_SPACING_MS = 400
const SCALE_NOTE_DURATION_MS = 350
/** How long a played chord rings, in ms. */
const CHORD_DURATION_MS = 800
/** Neither soft nor pinned to max — an audible, unremarkable press. */
const PLAY_VELOCITY = 80

/**
 * Play a scale ascending, one note after another at a fixed spacing —
 * REQ-3.5.3's "hear them". Every note's `atMs` is derived from one
 * `audioOutput.now()` reading plus its own fixed offset, never a fresh clock
 * read per note (see the module comment).
 *
 * `allNotesOff()` first: without it, a second press while the first
 * performance is still ringing stacks its notes on top rather than
 * restarting, and changing the root/scale mid-performance lets the old scale
 * finish playing under the new selection on screen (see the finding-3
 * report). The cleanup effect below covers the other two triggers — root/type
 * change and unmount — that a press-time panic alone cannot.
 */
function playScaleAscending(audioOutput: AudioOutput, notes: readonly SpelledPitch[]): void {
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
function playChordTones(audioOutput: AudioOutput, tones: readonly SpelledPitch[]): void {
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
 * Twelve pitch classes for the root picker, each spelled the way a learner
 * actually writes it — sharp for C#/F#/G#, flat for Db/Eb/Ab/Bb — so every
 * offered root names a writable key (see the ROOT_OPTIONS finding).
 */
const ROOT_OPTIONS: readonly SpelledPitch[] = Array.from({ length: 12 }, (_, pc) =>
  fromMidi(midi(pc + 60), FLAT_PITCH_CLASSES.has(pc)),
)

/** `'C#'`, `'Bb'` — a root option's name with no octave. */
function noteLabel(p: SpelledPitch): string {
  const sign = p.alter < 0 ? 'b'.repeat(-p.alter) : '#'.repeat(p.alter)
  return `${p.letter}${sign}`
}

const MINOR_SCALE_TYPES: ReadonlySet<ScaleType> = new Set<ScaleType>([
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'aeolian',
])

const SCALE_TYPE_LABEL: Readonly<Record<ScaleType, string>> = {
  major: 'Major',
  naturalMinor: 'Natural minor',
  harmonicMinor: 'Harmonic minor',
  melodicMinor: 'Melodic minor',
  ionian: 'Ionian',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  aeolian: 'Aeolian',
  locrian: 'Locrian',
  chromatic: 'Chromatic',
  majorPentatonic: 'Major pentatonic',
  minorPentatonic: 'Minor pentatonic',
  blues: 'Blues',
  wholeTone: 'Whole tone',
}

/** Scale types whose diatonic chords can be shown at all: major/ionian and the four minor forms. */
const MAJOR_SCALE_TYPES: ReadonlySet<ScaleType> = new Set<ScaleType>(['major', 'ionian'])

/**
 * The coarse major/minor key this scale type implies, for the chords section —
 * `null` for every mode/exotic scale (dorian, phrygian, lydian, mixolydian,
 * locrian, the pentatonics, blues, chromatic, whole tone) whose diatonic
 * chords are not the major or natural-minor reading, so showing them under
 * that scale's name would be a false theory statement (see the finding on
 * `keyModeFor`/`MINOR_SCALE_TYPES` fallthrough).
 */
function keyModeFor(type: ScaleType): Mode | null {
  if (MAJOR_SCALE_TYPES.has(type)) return 'major'
  if (MINOR_SCALE_TYPES.has(type)) return 'minor'
  return null
}

/**
 * Harmonic and melodic minor raise the 7th degree, which changes the V and
 * vii° chords from `diatonicChords`'s natural-minor-only reading (v minor,
 * VII major) to V major and vii° diminished built on the raised leading tone.
 * `diatonicChords` deliberately never mixes those in (harmony.ts:188-196), so
 * this substitutes them explicitly via `chordForRomanNumeral` for the two
 * scale types whose whole identity is that raised 7th.
 */
const RAISED_SEVENTH_SCALE_TYPES: ReadonlySet<ScaleType> = new Set<ScaleType>([
  'harmonicMinor',
  'melodicMinor',
])

function chordsForScale(key: Key, type: ScaleType): readonly Chord[] {
  const base = diatonicChords(key)
  if (!RAISED_SEVENTH_SCALE_TYPES.has(type)) return base
  const raisedV = chordForRomanNumeral('V', key)
  const raisedViio = chordForRomanNumeral('vii°', key)
  return base.map((chord, i) => {
    if (i === 4 && raisedV.ok) return raisedV.value
    if (i === 6 && raisedViio.ok) return raisedViio.value
    return chord
  })
}

function ScaleTable({ root, type }: { readonly root: SpelledPitch; readonly type: ScaleType }) {
  const scale = buildScale(root, type)
  const fingering = scaleFingering(root, type)
  const played = scaleNotes(root, type, 1)

  return (
    <table aria-label="Scale degrees" className="degree-table">
      <thead>
        <tr>
          <th>Degree</th>
          <th>Note</th>
          <th>Right hand</th>
          <th>Left hand</th>
        </tr>
      </thead>
      <tbody>
        {played.map((note, i) => {
          const isTonicRepeat = i === scale.notes.length
          const label = isTonicRepeat ? 'octave' : degreeName(type, i + 1)
          const rightFinger = fingering?.rightHand[i]
          const leftFinger = fingering?.leftHand[i]
          return (
            <tr key={i} data-testid={`scale-degree-${i + 1}`}>
              <td>{label}</td>
              <td>{pitchName(note)}</td>
              <td className="fingering">{rightFinger ?? '—'}</td>
              <td className="fingering">{leftFinger ?? '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ChordRow({
  numeralText,
  symbol,
  figures,
  pitchClasses,
  rootPitchClass,
  onPlay,
}: {
  readonly numeralText: string
  readonly symbol: string
  readonly figures: string
  readonly pitchClasses: ReadonlySet<number>
  readonly rootPitchClass: number
  /** Plays this row's exact chord tones as a simultaneity. */
  readonly onPlay: () => void
}) {
  return (
    <li data-testid={`diatonic-chord-${numeralText}`}>
      <span className="chord-roman roman">{numeralText}</span>{' '}
      <span className="chord-symbol">{symbol}</span>{' '}
      <span className="chord-figure figured-bass">{figures || 'root position'}</span>{' '}
      <button type="button" onClick={onPlay}>{`Play the ${numeralText} chord`}</button>
      <KeyboardDiagram
        low={midi(60)}
        high={midi(71)}
        highlightedPitchClasses={pitchClasses}
        rootPitchClass={rootPitchClass}
        ariaLabel={`${symbol} on the keyboard`}
      />
    </li>
  )
}

function DiatonicChords({
  root,
  type,
  mode,
  getAudioOutput,
}: {
  readonly root: SpelledPitch
  readonly type: ScaleType
  readonly mode: Mode
  readonly getAudioOutput: () => AudioOutput
}) {
  const keyResult = keyOf(root, mode)
  if (!keyResult.ok) {
    return (
      <p className="reference-key-error">
        {noteLabel(root)} {mode} is not a writable key — try a different root.
      </p>
    )
  }
  const key = keyResult.value
  const chords = chordsForScale(key, type)

  return (
    <ul aria-label="Diatonic chords" className="diatonic-chords chord-list">
      {chords.map((chord, i) => {
        const numeral = romanNumeralFor(chord, key)
        const numeralText = numeral?.text ?? `${i + 1}`
        const tones = chordTones(chord)
        return (
          <ChordRow
            key={numeralText}
            numeralText={numeralText}
            symbol={chordSymbol(chord)}
            figures={figuredBass(chord)}
            pitchClasses={new Set(tones.map(spelledPitchClass))}
            rootPitchClass={spelledPitchClass(chord.root)}
            onPlay={() => playChordTones(getAudioOutput(), tones)}
          />
        )
      })}
    </ul>
  )
}

export function ChordScaleReference({
  root,
  scaleType,
  onRootChange,
  onScaleTypeChange,
  audioOutput,
}: ChordScaleReferenceProps) {
  // Lazy by design: undefined until the first press, so the real
  // AudioContext (when no `audioOutput` prop is injected) is constructed
  // inside that press's click handler, never at mount — see the module
  // comment on the browser autoplay policy.
  //
  // The injected `audioOutput` prop is read directly rather than only seeding
  // the ref at first render: `useRef(audioOutput)` snapshots whatever the
  // prop was on mount, so a caller that mounts with it `undefined` and
  // supplies a real value later would silently keep using a real
  // `AudioContext` it built for itself instead of ever switching to the
  // caller's injected one (finding 5).
  const audioRef = useRef<AudioOutput | undefined>(undefined)
  function getAudioOutput(): AudioOutput {
    if (audioOutput !== undefined) return audioOutput
    if (audioRef.current === undefined) {
      audioRef.current = createDefaultAudioOutput()
    }
    return audioRef.current
  }

  // Cancel whatever is still ringing when the looked-up root/scale changes or
  // the screen unmounts (finding 3's other two triggers, beyond a same-button
  // second press, which `playScaleAscending`/`playChordTones` already cancel
  // themselves). Deliberately does NOT call `getAudioOutput()` — that would
  // force-construct a real `AudioContext` outside a user gesture on every
  // mount and every root/scale change, even for a learner who never presses
  // Play, which is exactly what the lazy-construction design above exists to
  // avoid. Only cancels an output that already exists.
  useEffect(() => {
    return () => {
      const existing = audioOutput ?? audioRef.current
      existing?.allNotesOff()
    }
  }, [root, scaleType, audioOutput])

  const scale = buildScale(root, scaleType)
  const highlighted = new Set(scale.notes.map(spelledPitchClass))
  const rootPc = spelledPitchClass(root)
  const mode = keyModeFor(scaleType)
  const played = scaleNotes(root, scaleType, 1)
  const fingering = scaleFingering(root, scaleType)
  const scaleLabels = new Map(
    played.flatMap((note, i) => {
      const finger = fingering?.rightHand[i]
      return finger === undefined ? [] : [[toMidi(note), String(finger)] as const]
    }),
  )
  // Match the root select by spelling (letter + alter) first, since two
  // options can share a pitch class only enharmonically never — but a
  // selected root reached via the circle of fifths (e.g. Db) must show "Db"
  // rather than falling back to the nearest pitch-class match "C#".
  const bySpelling = ROOT_OPTIONS.findIndex(
    (o) => o.letter === root.letter && o.alter === root.alter,
  )
  const currentRootIndex =
    bySpelling >= 0
      ? bySpelling
      : at(
          ROOT_OPTIONS.map((o, i) => (spelledPitchClass(o) === rootPc ? i : -1)).filter(
            (i) => i >= 0,
          ),
          0,
        )

  return (
    <section aria-label="Chord and scale reference" className="chord-scale-reference">
      <h2>Chord &amp; scale reference</h2>
      <div className="reference-pickers">
        <label htmlFor="reference-root-select">Root</label>
        <select
          id="reference-root-select"
          value={currentRootIndex}
          onChange={(e) => onRootChange(at(ROOT_OPTIONS, Number(e.target.value)))}
        >
          {ROOT_OPTIONS.map((option, i) => (
            <option key={i} value={i}>
              {noteLabel(option)}
            </option>
          ))}
        </select>

        <label htmlFor="reference-scale-select">Scale</label>
        <select
          id="reference-scale-select"
          value={scaleType}
          onChange={(e) => onScaleTypeChange(e.target.value as ScaleType)}
        >
          {SCALE_TYPES.map((type) => (
            <option key={type} value={type}>
              {SCALE_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </div>

      <h3 data-testid="reference-scale-name">{scaleName(scale)}</h3>
      <button
        type="button"
        onClick={() => playScaleAscending(getAudioOutput(), played)}
      >{`Play ${scaleName(scale)} scale`}</button>
      <KeyboardDiagram
        low={midi(60)}
        high={midi(72)}
        highlightedPitchClasses={highlighted}
        rootPitchClass={rootPc}
        labels={scaleLabels}
        ariaLabel={`${scaleName(scale)} on the keyboard`}
      />
      <ScaleTable root={root} type={scaleType} />

      {/* Reachability note (finding 6, no behaviour change): the scale Play
          button above renders for all 16 `SCALE_TYPES`, but a chord Play
          button exists only for the 6 scale types this `mode !== null` guard
          admits (major, ionian, and the four minor forms) — the other 10
          (the modes, pentatonics, blues, chromatic, whole tone) never show a
          chords section at all, so REQ-3.5.4's "hear it" is unreachable for
          them. Roadmap 3.15 is the task that gives modal/exotic scales their
          own chord reading instead of suppressing the section outright. */}
      {mode !== null && (
        <>
          <h3>Diatonic chords</h3>
          <DiatonicChords
            root={root}
            type={scaleType}
            mode={mode}
            getAudioOutput={getAudioOutput}
          />
        </>
      )}
    </section>
  )
}
