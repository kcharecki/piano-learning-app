/**
 * The chord lookup (roadmap 3.15, REQ-3.5.4): "look up ANY chord" — pick a
 * root, ANY chord quality (every triad and every seventh in `CHORD_QUALITIES`,
 * not just the seven diatonic chords of one key) and an inversion, and see the
 * chord symbol, its figured bass, its spelled tones and a keyboard highlight —
 * with a "hear it" play button, same as the diatonic-chords rows next to it.
 *
 * This is the fix for finding (a) on `ChordScaleReference.tsx`: that screen
 * only ever showed the seven diatonic triads of whichever key was selected, so
 * a learner could never look up e.g. "D-flat diminished seventh" — a chord
 * that belongs to no ordinary major/minor key at all. Rendering *this*
 * component from `ChordScaleReference` is what makes that reachable.
 *
 * An uncontrolled component, deliberately unlike `ChordScaleReference`: the
 * caller only seeds the starting root (`initialRoot`, typically the
 * reference's own current root, so the two stay roughly in sync at first
 * glance), and this component owns root/quality/inversion after that — a
 * lookup is a scratch pad the learner drives, not something the circle of
 * fifths needs to steer from outside.
 *
 * ## Playback and audio discipline
 *
 * `playChordTones`, the lazy-`AudioOutput` accessor, `ROOT_OPTIONS` and
 * `noteLabel` come from `./chordScaleAudio.ts` (roadmap 3.15a) — a leaf
 * module this file and `ChordScaleReference.tsx` both import, so this file no
 * longer carries its own copy (see that module's own comment for the full
 * playback rationale: the single shared `AudioContext`, built lazily inside a
 * user gesture because of the browser autoplay policy, and the
 * `allNotesOff()` panic at the top of every play).
 *
 * The panic-on-change cleanup effect below is NOT hoisted alongside them: it
 * is gated by `ringingRef` (see the comment on that ref) so that this
 * component only ever cancels a performance *it* started, unlike
 * `ChordScaleReference`'s own unconditional cleanup effect — the two are not
 * actually identical, so unifying them would change one or the other's
 * behaviour. `chordScaleAudio.ts`'s `stopRingingAudio` hoists only the one
 * line that genuinely is shared between the two effects (resolve the existing
 * output and cancel it).
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { AudioOutput } from '@core/ports/audio.ts'
import { at } from '@core/shared/invariant.ts'
import { midi } from '@core/shared/units.ts'
import {
  buildChord,
  CHORD_QUALITIES,
  type ChordQuality,
  chordSymbol,
  figuredBass,
  type Inversion,
  INVERSIONS,
  isTriad,
} from '@core/theory/chords.ts'
import { pitchName, type SpelledPitch, spelledPitchClass } from '@core/theory/pitch.ts'
import {
  noteLabel,
  playChordTones,
  ROOT_OPTIONS,
  stopRingingAudio,
  useSharedAudioOutput,
} from './chordScaleAudio.ts'
import { ChordStaff } from './ChordStaff.tsx'
import { KeyboardDiagram } from './KeyboardDiagram.tsx'

export type ChordLookupProps = {
  /** Seeds the picker's root; the component owns its root state after mount. */
  readonly initialRoot: SpelledPitch
  /** Optional audio seam for tests; defaults to the same shared output
   *  ChordScaleReference already uses. */
  readonly audioOutput?: AudioOutput
}

/**
 * Which `ROOT_OPTIONS` entry matches `root`: by spelling first (so a root
 * reached via a theoretical spelling `ChordScaleReference` might seed us with,
 * e.g. Cb, still shows as the nearest writable option rather than throwing),
 * falling back to pitch class. Always succeeds — the twelve options span every
 * pitch class — so the fallback's `-1` case is unreachable in practice and
 * defaults to 0 rather than asserting.
 */
function indexForRoot(root: SpelledPitch): number {
  const bySpelling = ROOT_OPTIONS.findIndex((o) => o.letter === root.letter && o.alter === root.alter)
  if (bySpelling >= 0) return bySpelling
  const rootPc = spelledPitchClass(root)
  const byPitchClass = ROOT_OPTIONS.findIndex((o) => spelledPitchClass(o) === rootPc)
  return byPitchClass >= 0 ? byPitchClass : 0
}

const QUALITY_LABEL: Readonly<Record<ChordQuality, string>> = {
  major: 'Major',
  minor: 'Minor',
  diminished: 'Diminished',
  augmented: 'Augmented',
  sus2: 'Sus2',
  sus4: 'Sus4',
  dominant7: 'Dominant 7th',
  major7: 'Major 7th',
  minor7: 'Minor 7th',
  halfDiminished7: 'Half-diminished 7th',
  diminished7: 'Diminished 7th',
  minorMajor7: 'Minor-major 7th',
  augmentedMajor7: 'Augmented-major 7th',
}

const INVERSION_LABEL: Readonly<Record<Inversion, string>> = {
  0: 'Root position',
  1: 'First inversion',
  2: 'Second inversion',
  3: 'Third inversion',
}

export function ChordLookup({ initialRoot, audioOutput }: ChordLookupProps): JSX.Element {
  // Normalised once at mount to the exact `ROOT_OPTIONS` entry the picker
  // will show, so state and picker can never disagree (finding 6): before
  // this, `root` held the raw `initialRoot` while the `<select>` displayed
  // `indexForRoot(root)`'s nearest-pitch-class match, so a spelling not in
  // `ROOT_OPTIONS` (e.g. a theoretical spelling from the circle of fifths)
  // showed one root in the picker and built the chord from another.
  const [root, setRoot] = useState<SpelledPitch>(() => at(ROOT_OPTIONS, indexForRoot(initialRoot)))
  const [quality, setQuality] = useState<ChordQuality>('major')
  const [inversion, setInversion] = useState<Inversion>(0)

  // Lazy by design, same discipline as ChordScaleReference: see this file's
  // module comment and `chordScaleAudio.ts`'s own comment on why.
  const { audioRef, getAudioOutput } = useSharedAudioOutput(audioOutput)
  // Whether *this* component has actually played a chord on the shared
  // output since the last panic. ChordScaleReference renders this component
  // against the same shared AudioContext (Chrome caps them at ~6/document),
  // so an unconditional `allNotesOff()` on every picker change silences
  // whatever the reference above is still playing even when the learner
  // never touched this lookup's play button (finding 2 — confirmed by
  // execution: selecting a quality here stopped a scale ChordScaleReference
  // was mid-playing). Gating the panic on "did *I* start something" fixes
  // that without changing ChordScaleReference's own panic discipline.
  const ringingRef = useRef(false)

  // Cancel whatever this lookup started ringing when the looked-up chord
  // changes or this component unmounts — the other half of the panic
  // discipline, matching ChordScaleReference's identical cleanup effect, but
  // gated by `ringingRef` (see above) so an untouched lookup cannot cancel a
  // performance it never started. `root` is a dependency deliberately
  // (finding 4): selecting a new root changes the looked-up chord exactly
  // like a quality or inversion change does, and a still-ringing chord must
  // not survive it either.
  useEffect(() => {
    return () => {
      if (!ringingRef.current) return
      stopRingingAudio(audioOutput, audioRef)
      ringingRef.current = false
    }
  }, [root, quality, inversion, audioOutput, audioRef])

  // A third inversion only exists on a seventh chord (chordMidi/buildChord
  // would throw for a triad) — INVERSIONS is filtered per the current
  // quality so the picker never offers one the quality cannot take.
  const availableInversions = isTriad(quality) ? INVERSIONS.filter((inv) => inv !== 3) : INVERSIONS

  function handleQualityChange(next: ChordQuality): void {
    setQuality(next)
    // Switching from a seventh's third inversion to a triad would otherwise
    // leave `inversion` pointing at a value the new quality cannot build.
    if (isTriad(next) && inversion === 3) setInversion(0)
  }

  const chord = buildChord(root, quality, inversion)
  const symbol = chordSymbol(chord)
  const figures = figuredBass(chord)
  const pitchClasses = new Set(chord.notes.map(spelledPitchClass))
  const rootPitchClass = spelledPitchClass(chord.root)

  return (
    <section aria-label="Chord lookup" className="chord-lookup">
      <h2>Look up any chord</h2>
      <div className="chord-lookup-pickers">
        {/* "Chord root", not "Root" — ChordScaleReference already owns the
            label "Root" for its own scale-root picker, and this component is
            rendered inside that same screen, so reusing "Root" here would
            make every `getByLabelText('Root')` query in the app ambiguous. */}
        <label htmlFor="chord-lookup-root-select">Chord root</label>
        <select
          id="chord-lookup-root-select"
          value={indexForRoot(root)}
          onChange={(e) => setRoot(at(ROOT_OPTIONS, Number(e.target.value)))}
        >
          {ROOT_OPTIONS.map((option, i) => (
            <option key={i} value={i}>
              {noteLabel(option)}
            </option>
          ))}
        </select>

        <label htmlFor="chord-lookup-quality-select">Chord quality</label>
        <select
          id="chord-lookup-quality-select"
          value={quality}
          onChange={(e) => handleQualityChange(e.target.value as ChordQuality)}
        >
          {CHORD_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {QUALITY_LABEL[q]}
            </option>
          ))}
        </select>

        <label htmlFor="chord-lookup-inversion-select">Inversion</label>
        <select
          id="chord-lookup-inversion-select"
          value={inversion}
          onChange={(e) => setInversion(Number(e.target.value) as Inversion)}
        >
          {availableInversions.map((inv) => (
            <option key={inv} value={inv}>
              {INVERSION_LABEL[inv]}
            </option>
          ))}
        </select>
      </div>

      <h3 data-testid="chord-lookup-symbol">{symbol}</h3>
      <p data-testid="chord-lookup-figures">{figures || 'root position'}</p>
      <ul aria-label="Chord tones" className="chord-lookup-tones">
        {chord.notes.map((tone, i) => (
          <li key={i}>{pitchName(tone)}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          ringingRef.current = true
          playChordTones(getAudioOutput(), chord.notes)
        }}
      >{`Play the ${symbol} chord`}</button>
      <KeyboardDiagram
        low={midi(60)}
        high={midi(71)}
        highlightedPitchClasses={pitchClasses}
        rootPitchClass={rootPitchClass}
        ariaLabel={`${symbol} on the keyboard`}
      />
      {/* REQ-3.5.3's "see it on staff and keyboard" (roadmap 5.50): the
          keyboard diagram above shows which keys to press; this shows what a
          learner actually has to read at the piano — the looked-up chord's
          own tones, correctly voiced for the picked inversion, engraved as a
          real simultaneity. Same pipeline `ScaleStaff` already uses for
          scales. */}
      <ChordStaff notes={chord.notes} title={symbol} />
    </section>
  )
}
