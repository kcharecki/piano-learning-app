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
 * `playChordTones` and the lazy-`AudioOutput` / panic-on-change wiring below
 * are a deliberate line-for-line mirror of `ChordScaleReference`'s own (see
 * that file's module comment for the full rationale: the single shared
 * `AudioContext`, built lazily inside a user gesture because of the browser
 * autoplay policy, and the `allNotesOff()` panic both at the top of every
 * play and in a cleanup effect keyed on the looked-up chord, so a still-
 * ringing chord never survives a picker change or unmount). It is duplicated
 * rather than imported from `ChordScaleReference.tsx`. Note: the helpers
 * duplicated below (`playChordTones`, the duration/velocity constants,
 * `ROOT_OPTIONS`, `noteLabel`, the lazy-audio getter) do not themselves
 * depend on either component, so a real circular import is not actually
 * forced here — they could be hoisted into a third leaf module both
 * components import. That extraction is out of scope for this file (it
 * would touch `ChordScaleReference.tsx` and add a new module neither of this
 * change's owned files), so it is left as a known follow-up rather than done
 * silently; the duplication cost is real (see e.g. `CHORD_DURATION_MS`
 * existing in both files) but is not a defect this component can fix alone.
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import type { AudioOutput } from '@core/ports/audio.ts'
import { at } from '@core/shared/invariant.ts'
import { midi, millis } from '@core/shared/units.ts'
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
import { fromMidi, pitchName, type SpelledPitch, spelledPitchClass, toMidi } from '@core/theory/pitch.ts'
import { KeyboardDiagram } from './KeyboardDiagram.tsx'

export type ChordLookupProps = {
  /** Seeds the picker's root; the component owns its root state after mount. */
  readonly initialRoot: SpelledPitch
  /** Optional audio seam for tests; defaults to the same shared output
   *  ChordScaleReference already uses. */
  readonly audioOutput?: AudioOutput
}

/** How long a played chord rings, in ms. Mirrors `ChordScaleReference`'s `CHORD_DURATION_MS`. */
const CHORD_DURATION_MS = 800
/** Neither soft nor pinned to max — an audible, unremarkable press. */
const PLAY_VELOCITY = 80

/**
 * Play a chord as a simultaneity — every tone at the exact same instant. See
 * this file's module comment for why this duplicates rather than imports
 * `ChordScaleReference.tsx`'s identical `playChordTones`.
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
 * actually writes it — sharp for C#/F#/G#, flat for Db/Eb/Ab/Bb. Mirrors
 * `ChordScaleReference`'s own `ROOT_OPTIONS` (see that file for the
 * writable-key rationale); duplicated for the same circular-import reason as
 * `playChordTones` above.
 */
const ROOT_OPTIONS: readonly SpelledPitch[] = Array.from({ length: 12 }, (_, pc) =>
  fromMidi(midi(pc + 60), FLAT_PITCH_CLASSES.has(pc)),
)

/** `'C#'`, `'Bb'` — a root option's name with no octave. */
function noteLabel(p: SpelledPitch): string {
  const sign = p.alter < 0 ? 'b'.repeat(-p.alter) : '#'.repeat(p.alter)
  return `${p.letter}${sign}`
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
  // module comment and ChordScaleReference.tsx's own comment on why.
  const audioRef = useRef<AudioOutput | undefined>(undefined)
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
  function getAudioOutput(): AudioOutput {
    if (audioOutput !== undefined) return audioOutput
    if (audioRef.current === undefined) {
      audioRef.current = createDefaultAudioOutput()
    }
    return audioRef.current
  }

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
      const existing = audioOutput ?? audioRef.current
      existing?.allNotesOff()
      ringingRef.current = false
    }
  }, [root, quality, inversion, audioOutput])

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
    </section>
  )
}
