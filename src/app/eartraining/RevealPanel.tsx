/**
 * The post-answer reveal (roadmap 5.29, REQ-3.6.1/3.6.2): before this
 * existed, `EarTrainingScreen`'s only feedback was the word "Correct" or
 * "Not quite — it was {interval name}" — a learner who guessed right learned
 * exactly as much as one who guessed wrong, because nothing ever showed WHAT
 * was actually heard. This renders, for whichever item is on screen:
 *
 *  - the answer named with its real, sounding pitches (not just an interval
 *    or quality NAME — "a perfect fifth" names a relationship, "C4 and G4"
 *    names the thing that actually happened);
 *  - those pitches engraved on a staff, reusing the exact OSMD pipeline
 *    `ScaleStaff`/`ChordScaleReference` already drive (`createOsmdEngraver`'s
 *    `'reference'` presentation) — `item.prompt` is already a valid `Score`
 *    for every drill kind here, so this needs no new Score-building logic,
 *    only a `'reference'`-presentation engraver wired to it directly;
 *  - those same pitches on `KeyboardDiagram` (`@app/theory` — imported, never
 *    edited, per the task brief);
 *  - for the two interval kinds only, a fixed-register reference — see
 *    `useEarTraining.ts`'s own `playIntervalReference` doc for why "fixed
 *    register" is the whole point — plus a well-known tune many learners
 *    already associate with that interval's sound, named (never
 *    reproduced — no melody, no lyrics) as a mnemonic.
 *
 * `EarTrainingScreen`'s own "Replay" control (in the Playback button group,
 * already wired and already tested) is what satisfies "replay with the
 * answer named": once this panel is showing, Replay plays `item.prompt`
 * again while this stays on screen, so hearing and seeing the answer happen
 * together. This file adds no second Replay button — one control, reachable
 * from a reveal that is now actually worth replaying against.
 */
import type { JSX } from 'react'
import { createOsmdEngraver } from '@app/score/osmdEngraver.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { KeyboardDiagram } from '@app/theory/KeyboardDiagram.tsx'
import type { EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { intervalLongName, intervalName, makeInterval, parseInterval, type Interval } from '@core/theory/intervals.ts'
import { midiToName } from '@core/theory/pitch.ts'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, type Midi } from '@core/shared/units.ts'
import { humanize } from './QualityAnswerButtons.tsx'

export type RevealPanelProps = {
  readonly kind: EarItemKind
  readonly item: EarItem
  /** Roadmap 5.29: play the item's interval from a fixed register — see
   *  `useEarTraining.ts`'s own doc. Omitted (rather than passed as a no-op)
   *  for a non-interval kind, so no reference control renders for one. */
  readonly onPlayReference?: () => void
}

/**
 * This screen's own reference-presentation engraver factory — the same
 * `createOsmdEngraver({ presentation: 'reference' })` call
 * `ScaleStaff.tsx`'s own `createReferenceEngraver` makes (see that file):
 * no playback cursor, no tempo mark, no engraved title, tight margins. Not
 * imported from `ScaleStaff.tsx` itself — that file's own export is the
 * *component*, scoped to a root + `ScaleType`, which cannot render an
 * arbitrary two-note interval or a dictation phrase; `createOsmdEngraver` is
 * the general piece both files are built on. Module-level so its identity is
 * stable across renders, matching `ScaleStaff.tsx`'s own reasoning.
 */
const createReferenceEngraver = (): ReturnType<typeof createOsmdEngraver> =>
  createOsmdEngraver({ presentation: 'reference' })

/** `item.prompt.notes`, in the order a learner actually heard them: onset
 *  first, then pitch (simultaneous notes — a harmonic interval, a block
 *  chord — have no onset order, so pitch low-to-high is the only stable one
 *  left to read them in). */
function orderedNotes(item: EarItem): readonly { readonly midi: Midi }[] {
  return [...item.prompt.notes].sort((a, b) => a.startTick - b.startTick || a.midi - b.midi)
}

/** The interval this item asked about, direction stripped — `undefined` for a
 *  non-interval kind or an unparseable `answerKey` (defensive; every
 *  `answerKey` this app itself generates parses). */
function intervalFromItem(item: EarItem): { readonly interval: Interval; readonly descending: boolean } | undefined {
  const descending = item.answerKey.startsWith('-')
  const parsed = parseInterval(descending ? item.answerKey.slice(1) : item.answerKey)
  return parsed.ok ? { interval: parsed.value, descending } : undefined
}

/**
 * Well-known tunes many learners already associate with an interval's sound
 * — a standard ear-training mnemonic device (found in method books and
 * teaching sites alike), named here as plain facts about musical convention,
 * never reproduced: no melody, no lyrics, just the title. Keyed by the
 * interval's SIMPLE form (`intervalName` of number <= 8) — a ninth still
 * "sounds like" a second widened by an octave, so `referenceTuneFor` folds
 * every compound this drill's level 5 can draw back onto these twelve.
 */
const REFERENCE_TUNES: Readonly<Record<string, string>> = {
  P1: 'the same note twice — no tune needed',
  m2: '"Jaws" (the theme)',
  M2: '"Happy Birthday to You" (the first two notes)',
  m3: '"Greensleeves" (the opening phrase)',
  M3: '"When the Saints Go Marching In" (the opening)',
  P4: '"Here Comes the Bride" (Wagner\'s Bridal Chorus)',
  A4: '"The Simpsons" theme (the opening)',
  P5: '"Twinkle, Twinkle, Little Star"',
  m6: '"The Entertainer" (Scott Joplin)',
  M6: '"My Bonnie Lies Over the Ocean"',
  m7: '"Somewhere" (West Side Story) — the opening leap',
  M7: '"Take On Me" (the chorus leap)',
  P8: '"Somewhere Over the Rainbow" (the opening leap)',
}

/** Reduces a compound interval (number > 8) to its simple form for the mnemonic lookup —
 *  see `REFERENCE_TUNES`'s own doc. Never fails for an interval this drill's own vocabulary
 *  produces (`intervals.ts`'s `compound` only ever adds 7 to an already-legal number). */
function referenceTuneFor(interval: Interval): string | undefined {
  if (interval.number <= 8) return REFERENCE_TUNES[intervalName(interval)]
  const simple = makeInterval(interval.number - 7, interval.quality)
  return simple.ok ? REFERENCE_TUNES[intervalName(simple.value)] : undefined
}

/** `{ low, high }` for `KeyboardDiagram`, padded a couple of semitones either side of the
 *  sounding notes so the highlighted keys are not flush against the diagram's own edge. */
function keyboardRangeFor(notes: readonly { readonly midi: Midi }[]): { readonly low: Midi; readonly high: Midi } {
  const values = notes.map((n) => n.midi)
  const low = midi(Math.max(PIANO_LOWEST_MIDI, Math.min(...values) - 2))
  const high = midi(Math.min(PIANO_HIGHEST_MIDI, Math.max(...values) + 2))
  return { low, high }
}

/** The answer, named with its real sounding pitches — never just the interval/quality name
 *  alone (roadmap 5.29's whole point: "a perfect fifth" vs "a perfect fifth — C4 and G4"). */
function AnswerNaming({ kind, item }: { readonly kind: EarItemKind; readonly item: EarItem }): JSX.Element {
  const ordered = orderedNotes(item)
  const names = ordered.map((n) => midiToName(n.midi))

  if (kind === 'interval-melodic' || kind === 'interval-harmonic') {
    const parsed = intervalFromItem(item)
    const label = parsed === undefined ? item.answerKey : intervalLongName(parsed.interval)
    const joiner = kind === 'interval-melodic' ? 'then' : 'and'
    return (
      <p data-testid="reveal-answer-naming">
        {label}
        {parsed !== undefined && kind === 'interval-melodic' ? `, ${parsed.descending ? 'descending' : 'ascending'}` : ''}
        {' — '}
        {names[0]} {joiner} {names[1]}
      </p>
    )
  }
  if (kind === 'chord-quality' || kind === 'scale-mode') {
    return (
      <p data-testid="reveal-answer-naming">
        {humanize(item.answerKey)} {'— '}
        {names.join(', ')}
      </p>
    )
  }
  // Dictation: the answerKey is an internal onset/pitch key, not a name — the
  // pitch sequence itself (already in heard order) is the whole answer.
  if (kind === 'rhythmic-dictation') {
    return (
      <p data-testid="reveal-answer-naming">
        {ordered.length} onset{ordered.length === 1 ? '' : 's'} — pitch did not matter, only the timing
      </p>
    )
  }
  return <p data-testid="reveal-answer-naming">The phrase: {names.join(', ')}</p>
}

export function RevealPanel({ kind, item, onPlayReference }: RevealPanelProps): JSX.Element {
  const ordered = orderedNotes(item)
  const pitchClasses = new Set(ordered.map((n) => ((n.midi % 12) + 12) % 12))
  const rootMidi = item.contextTonicMidi ?? ordered[0]?.midi
  const rootPitchClass = rootMidi === undefined ? undefined : ((rootMidi % 12) + 12) % 12
  const { low, high } = keyboardRangeFor(ordered)
  const isInterval = kind === 'interval-melodic' || kind === 'interval-harmonic'
  const parsedInterval = isInterval ? intervalFromItem(item) : undefined
  const tune = parsedInterval === undefined ? undefined : referenceTuneFor(parsedInterval.interval)

  return (
    // roadmap UI-13: restyled onto `.card` (primitives.css) so the reveal
    // reads as its own surface sitting under the answered card, not a plain
    // block of text — the class list order does not matter to the cascade,
    // but `.eartraining-reveal` keeps owning layout (flex/gap) while `.card`
    // supplies the surface (background/radius/elevation/padding).
    <section aria-label="Answer reveal" className="card eartraining-reveal">
      <AnswerNaming kind={kind} item={item} />

      <div
        role="img"
        aria-label="The answer's pitches, on staff"
        className="eartraining-reveal-staff"
        data-testid="reveal-staff"
      >
        <ExerciseScore score={item.prompt} createEngraver={createReferenceEngraver} />
      </div>

      <KeyboardDiagram
        low={low}
        high={high}
        highlightedPitchClasses={pitchClasses}
        {...(rootPitchClass === undefined ? {} : { rootPitchClass })}
        labels={new Map(ordered.map((n) => [n.midi, midiToName(n.midi)] as const))}
        ariaLabel="The answer's pitches, on the keyboard"
      />

      {isInterval && onPlayReference !== undefined && (
        <div className="eartraining-reference-tune" data-testid="reveal-reference-tune">
          <button type="button" onClick={onPlayReference}>
            Play reference interval
          </button>
          {tune !== undefined && (
            <p>
              Many learners associate this interval with {tune} — try singing that opening
              alongside it.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
