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
 * `playScaleAscending`/`playChordTones`, the lazy-`AudioOutput` accessor,
 * `ROOT_OPTIONS` and `noteLabel` live in `./chordScaleAudio.ts` (roadmap
 * 3.15a) — a leaf module this file and `ChordLookup.tsx` both import, so
 * neither carries its own copy any more.
 */
import { useEffect, useState } from 'react'
import type { AudioOutput } from '@core/ports/audio.ts'
import { at } from '@core/shared/invariant.ts'
import { midi } from '@core/shared/units.ts'
import { chordSymbol, chordTones, figuredBass, type Chord } from '@core/theory/chords.ts'
import { chordForRomanNumeral, diatonicChords, romanNumeralFor } from '@core/theory/harmony.ts'
import { keyOf, type Key, type Mode } from '@core/theory/keys.ts'
import { pitchName, type SpelledPitch, spelledPitchClass, toMidi } from '@core/theory/pitch.ts'
import {
  buildScale,
  degreeName,
  NO_STANDARD_FINGERING_TYPES,
  noteAtDegree,
  scaleFingering,
  scaleName,
  scaleNotes,
  SCALE_TYPES,
  type Scale,
  type ScaleType,
} from '@core/theory/scales.ts'
import { ChordLookup } from './ChordLookup.tsx'
import {
  noteLabel,
  playChordTones,
  playScaleAscending,
  ROOT_OPTIONS,
  stopRingingAudio,
  useSharedAudioOutput,
} from './chordScaleAudio.ts'
import { ChordStaff } from './ChordStaff.tsx'
import { KeyboardDiagram } from './KeyboardDiagram.tsx'
import { ScaleStaff } from './ScaleStaff.tsx'

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

/**
 * The scale-type picker's own entries (roadmap 5.36): one per *distinct*
 * scale, not one per name. `ionian` is the exact same notes as `major` and
 * `aeolian` is the exact same notes as `naturalMinor` (see `scales.ts`'s
 * `SCALE_INTERVALS` comment: "the modes are the rotations of the major
 * scale, which is why `ionian` duplicates `major` and `aeolian` duplicates
 * `naturalMinor`") — so listing both names as separate rows reads to a
 * beginner as two different scales when they are one. `SCALE_TYPES` (the
 * core enum `ChordScaleReference` may not edit) still carries both names,
 * because `keyModeFor`/`MAJOR_SCALE_TYPES` above and callers elsewhere still
 * need to recognise a `scaleType` of literally `'ionian'` or `'aeolian'`
 * (e.g. this component's own `scaleType` prop, which some future caller
 * could still pass either value) — only *this picker's own option list*
 * collapses the pair, via {@link scaleTypeForPicker} below.
 */
const SCALE_TYPE_OPTIONS: readonly ScaleType[] = SCALE_TYPES.filter(
  (type) => type !== 'ionian' && type !== 'aeolian',
)

/**
 * The alternate name shown as a subtitle under the merged `major`/
 * `naturalMinor` entries (roadmap 5.36's "with the alternative name shown as
 * a subtitle"). `undefined` for every other scale type, which has no merged
 * partner.
 */
const SCALE_TYPE_ALT_NAME: Readonly<Partial<Record<ScaleType, string>>> = {
  major: 'Ionian',
  naturalMinor: 'Aeolian',
}

/**
 * Maps a `scaleType` onto the picker's own canonical value: `SCALE_TYPE_OPTIONS`
 * never offers `ionian`/`aeolian` as an `<option>` (they are folded into
 * `major`/`naturalMinor`), so a `scaleType` of either must still resolve to a
 * value the `<select>` actually has, or React would render it with nothing
 * selected.
 */
function scaleTypeForPicker(type: ScaleType): ScaleType {
  if (type === 'ionian') return 'major'
  if (type === 'aeolian') return 'naturalMinor'
  return type
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

function chordsForScale(key: Key, type: ScaleType, seventh: boolean): readonly Chord[] {
  const base = diatonicChords(key, seventh)
  if (!RAISED_SEVENTH_SCALE_TYPES.has(type)) return base
  const raisedV = chordForRomanNumeral(seventh ? 'V7' : 'V', key)
  const raisedViio = chordForRomanNumeral(seventh ? 'vii°7' : 'vii°', key)
  return base.map((chord, i) => {
    if (i === 4 && raisedV.ok) return raisedV.value
    if (i === 6 && raisedViio.ok) return raisedViio.value
    return chord
  })
}

/**
 * For scale types with no key (`mode === null`: the modes, pentatonics,
 * blues, chromatic, whole tone — see {@link keyModeFor}), there is no
 * diatonic function to read chords off. This is the deliberate, honest
 * substitute (roadmap 3.15's fix for the finding that used to make the whole
 * chords section vanish for these ten scale types): a triad (or, with
 * `seventh`, a four-note chord) built on each of the *scale's own* degrees,
 * by stacking every other scale step — 1-3-5, or 1-3-5-7 — exactly the way a
 * diatonic triad is built on a heptatonic scale, generalised through
 * {@link noteAtDegree}'s wrapping so it works for a 5-, 6-, 7- or 12-note
 * scale alike. It is *not* major/minor-key harmony — there is no key to read
 * against — so these chords are labelled with their literal spelled tones
 * rather than a `major`/`minor`/… quality name, which `chordSymbol` would
 * have to invent for a stack that need not match any of `CHORD_QUALITIES`'s
 * fixed interval patterns (a whole-tone scale's degree stack always comes out
 * augmented, but a blues or chromatic scale's does not reliably come out
 * anything nameable at all).
 */
function scaleDegreeStacks(scale: Scale, seventh: boolean): readonly (readonly SpelledPitch[])[] {
  const span = scale.notes.length
  const stackSize = seventh ? 4 : 3
  return Array.from({ length: span }, (_, i) =>
    Array.from({ length: stackSize }, (_, j) => noteAtDegree(scale, i + 1 + j * 2)),
  )
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
          if (fingering === null && NO_STANDARD_FINGERING_TYPES.has(type)) {
            return (
              <tr key={i} data-testid={`scale-degree-${i + 1}`}>
                <td>{label}</td>
                <td>{pitchName(note)}</td>
                <td className="fingering" colSpan={2}>
                  no standard fingering — modes are not in the graded syllabi
                </td>
              </tr>
            )
          }
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
  tones,
  pitchClasses,
  rootPitchClass,
  onPlay,
}: {
  readonly numeralText: string
  readonly symbol: string
  readonly figures: string
  /** The row's exact tones, sounding order — carried straight through to
   *  `ChordStaff` so the staff engraves precisely what the keyboard diagram
   *  highlights and the Play button sounds (roadmap 5.50). */
  readonly tones: readonly SpelledPitch[]
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
      {/* REQ-3.5.3's "see it on staff and keyboard" (roadmap 5.50): the
          gap 5.38's re-verification found — a chord was keyboard + audio
          only, never engraved. Same pipeline `ScaleStaff` already uses. */}
      <ChordStaff notes={tones} title={symbol} />
    </li>
  )
}

function DiatonicChords({
  chordKey,
  type,
  seventh,
  getAudioOutput,
}: {
  readonly chordKey: Key
  readonly type: ScaleType
  readonly seventh: boolean
  readonly getAudioOutput: () => AudioOutput
}) {
  const key = chordKey
  const chords = chordsForScale(key, type, seventh)

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
            tones={tones}
            pitchClasses={new Set(tones.map(spelledPitchClass))}
            rootPitchClass={spelledPitchClass(chord.root)}
            onPlay={() => playChordTones(getAudioOutput(), tones)}
          />
        )
      })}
    </ul>
  )
}

/** The chords section for a scale type with no key — see {@link scaleDegreeStacks}. */
function ScaleDegreeChords({
  scale,
  seventh,
  getAudioOutput,
}: {
  readonly scale: Scale
  readonly seventh: boolean
  readonly getAudioOutput: () => AudioOutput
}) {
  const stacks = scaleDegreeStacks(scale, seventh)
  return (
    <ul aria-label="Chords from scale degrees" className="diatonic-chords chord-list">
      {stacks.map((tones, i) => {
        const root = at(tones, 0)
        return (
          <ChordRow
            key={i}
            numeralText={`${i + 1}`}
            symbol={tones.map(noteLabel).join('–')}
            figures=""
            tones={tones}
            pitchClasses={new Set(tones.map(spelledPitchClass))}
            rootPitchClass={spelledPitchClass(root)}
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
  // comment on the browser autoplay policy. `useSharedAudioOutput` (roadmap
  // 3.15a) is the leaf-module hoist of what used to be this component's own
  // ref + lazy-getter, identical to `ChordLookup`'s copy of the same thing.
  const { audioRef, getAudioOutput } = useSharedAudioOutput(audioOutput)
  // Shared by both chord-section renderings (DiatonicChords and
  // ScaleDegreeChords) so "Show seventh chords" is one control, not two.
  const [seventh, setSeventh] = useState(false)

  // Cancel whatever is still ringing when the looked-up root/scale changes or
  // the screen unmounts (finding 3's other two triggers, beyond a same-button
  // second press, which `playScaleAscending`/`playChordTones` already cancel
  // themselves). Deliberately does NOT call `getAudioOutput()` — that would
  // force-construct a real `AudioContext` outside a user gesture on every
  // mount and every root/scale change, even for a learner who never presses
  // Play, which is exactly what the lazy-construction design above exists to
  // avoid. `stopRingingAudio` only cancels an output that already exists.
  useEffect(() => {
    return () => {
      stopRingingAudio(audioOutput, audioRef)
    }
    // `seventh` included (finding 7): toggling "Show seventh chords" swaps
    // every chord row's tones under a still-ringing chord (a V triad becomes
    // V7 with different tones) exactly like a root/scale-type change does,
    // so it must panic too — without it, ticking the checkbox mid-ring left
    // the old triad audibly playing under the new seventh-chord row.
  }, [root, scaleType, seventh, audioOutput, audioRef])

  const scale = buildScale(root, scaleType)
  const highlighted = new Set(scale.notes.map(spelledPitchClass))
  const rootPc = spelledPitchClass(root)
  const mode = keyModeFor(scaleType)
  // Hoisted here (finding 3) so the chords-section branch is chosen on
  // whether the key actually exists, not merely on whether a mode was
  // implied: `mode` can be non-null (naturalMinor/harmonicMinor/
  // melodicMinor/aeolian) while `keyOf` still fails for a root with no
  // writable minor spelling (e.g. Db minor — Db is a writable major key but
  // not a writable minor one). Previously that case fell into
  // `DiatonicChords`, which returned only an error paragraph and no chords
  // at all — the same "chords section vanishes" defect this file's
  // `ScaleDegreeChords` fallback was built to fix, just reached by a
  // different scale type. Falling back to `ScaleDegreeChords` (built purely
  // from the scale's own notes, no key required) covers it honestly.
  const keyResult = mode === null ? undefined : keyOf(root, mode)
  const chordKey = keyResult?.ok === true ? keyResult.value : null
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
  // Roadmap 5.36: the picker shows one entry per distinct scale, so a
  // `scaleType` of `ionian`/`aeolian` must still land on its merged
  // `major`/`naturalMinor` option rather than leaving the `<select>` with no
  // matching value.
  const pickerScaleType = scaleTypeForPicker(scaleType)
  const scaleAltName = SCALE_TYPE_ALT_NAME[pickerScaleType]

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
          value={pickerScaleType}
          onChange={(e) => onScaleTypeChange(e.target.value as ScaleType)}
        >
          {SCALE_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {SCALE_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
        {/* Roadmap 5.36: "the alternative name shown as a subtitle" — Major
            and Natural minor are the only two entries with a merged partner
            (Ionian/Aeolian), so this is the one place that alternate name
            still surfaces, right under the picker it belongs to. */}
        {scaleAltName !== undefined && (
          <p>
            <small data-testid="reference-scale-alt-name">Also known as {scaleAltName}</small>
          </p>
        )}
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
      {/* REQ-3.5.3's "see it on staff and keyboard": the keyboard diagram
          above shows which keys to press; this shows what a learner actually
          has to read at the piano — the same scale, engraved. */}
      <ScaleStaff root={root} scaleType={scaleType} />
      <ScaleTable root={root} type={scaleType} />

      {/* Roadmap 3.15 fix: this section used to vanish outright for the ten
          modal/exotic `SCALE_TYPES` `mode === null` admits (see the removed
          finding-6 comment this replaced) — now every scale type renders a
          chords section, reading real diatonic function where a key exists
          and `scaleDegreeStacks`' honest scale-degree stacking where it
          doesn't, so REQ-3.5.4's "hear it" is reachable for all 16. */}
      <h3>{chordKey !== null ? 'Diatonic chords' : "Chords built on this scale's degrees"}</h3>
      <label htmlFor="reference-seventh-checkbox">
        <input
          id="reference-seventh-checkbox"
          type="checkbox"
          checked={seventh}
          onChange={(e) => setSeventh(e.target.checked)}
        />
        {' '}Show seventh chords
      </label>
      {chordKey !== null ? (
        <DiatonicChords
          chordKey={chordKey}
          type={scaleType}
          seventh={seventh}
          getAudioOutput={getAudioOutput}
        />
      ) : (
        <ScaleDegreeChords scale={scale} seventh={seventh} getAudioOutput={getAudioOutput} />
      )}

      {/* `key` re-seeds ChordLookup's root whenever the reference's own root
          changes (finding 1): `initialRoot` is otherwise read only at mount
          (ChordLookup is deliberately uncontrolled after that — see its own
          module comment), and this element's position never changes, so
          without a key that reads `root`, selecting e.g. Ab on the circle of
          fifths left the lookup silently seeded on whatever root it first
          mounted with. Remounting also resets quality/inversion, which is
          the right behaviour here: a new reference root is a new lookup
          session, not a mid-edit of the old one. */}
      <ChordLookup
        key={`${root.letter}${root.alter}`}
        initialRoot={root}
        {...(audioOutput === undefined ? {} : { audioOutput })}
      />
    </section>
  )
}
