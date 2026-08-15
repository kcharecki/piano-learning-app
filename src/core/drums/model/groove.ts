/**
 * `GrooveScore` — the notated thing trainers play (DR-04). One time signature
 * and one swing feel for the whole score: a groove is a short authored
 * pattern/loop (DR-13's editor, DR-09's trainer content), not a full chart
 * with meter modulations — that is DR-26/DR-28's problem if it ever arrives,
 * and keeping this model to a single metre/swing is what keeps the grid
 * projection (`./grid.ts`) tractable.
 *
 * Mirrors `core/notation/score.ts`'s split: `makeGrooveScore` throws
 * (programmer error — it is fed already-validated data, same as `makeScore`)
 * and `validateGrooveScore` returns a `Result`, which is what a parser
 * (`./musicxml/`) runs on the structure it built before handing it on.
 *
 * `voice` is NEVER a free input — it is derived from `pad` via `voiceOf` at
 * construction time, so "feet never stems-up" (the property test in
 * `groove.test.ts`) holds by construction, not by a check a caller could skip.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { ticks, type Ticks } from '@core/shared/units.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import { isArticulation, isSticking, type Articulation, type Sticking } from './articulation.ts'
import { type MappedDrumPad, padOrderIndex, voiceOf, type Voice } from './pad.ts'
import type { VelocityClass } from './velocity.ts'

/** The notated dynamics class — the same three-way vocabulary `velocityClassOf` classifies live hits into. */
export type DynamicsClass = VelocityClass

export type GrooveNote = {
  /** Stable, derived from position: `g3.snare.960` (measureIndex.pad.tick). */
  readonly id: string
  readonly pad: MappedDrumPad
  readonly tick: Ticks
  /** Display only — drums are onset events, this exists for engraving (DR-05). */
  readonly durationTicks: Ticks
  readonly voice: Voice
  readonly dynamics: DynamicsClass
  readonly articulations: readonly Articulation[]
  readonly sticking?: Sticking
  /** 0-based index into `GrooveScore.measures`. */
  readonly measureIndex: number
}

export type GrooveMeasure = {
  readonly index: number
  readonly startTick: Ticks
  readonly durationTicks: Ticks
}

export type GrooveScore = {
  readonly id: string
  readonly title: string
  readonly timeSignature: TimeSignature
  /**
   * Whole percent, 50..75 (research §1/§3's practical swing range — 50 is
   * straight, 75 is a heavy shuffle; nothing outside that band is a
   * meaningful "swing" reading). Integer, not just for musical sense but so
   * the MusicXML bridge can round-trip it exactly as a `<first>/<second>`
   * integer ratio summing to 100 — see `./musicxml/write.ts`. See `./grid.ts`
   * for how this bends subdivision ticks.
   */
  readonly swingPercent: number
  readonly measures: readonly GrooveMeasure[]
  /** ALWAYS sorted by `tick`, then by `padOrderIndex(pad)`. */
  readonly notes: readonly GrooveNote[]
}

// ---------------------------------------------------------------- construction

export type GrooveNoteInput = {
  readonly pad: MappedDrumPad
  readonly tick: number
  readonly durationTicks: number
  /** Defaults to `'normal'`. */
  readonly dynamics?: DynamicsClass
  readonly articulations?: readonly Articulation[]
  readonly sticking?: Sticking
}

export type GrooveScoreInput = {
  readonly id: string
  readonly title?: string
  /** Defaults to 4/4. */
  readonly timeSignature?: TimeSignature
  /** Defaults to 50 (straight). Whole percent, 50..75 — see `GrooveScore.swingPercent`. */
  readonly swingPercent?: number
  /** Every measure is a full bar of `timeSignature` — grooves do not carry pickups. */
  readonly measureCount: number
  readonly notes: readonly GrooveNoteInput[]
}

const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
const DEFAULT_SWING_PERCENT = 50
const DEFAULT_DYNAMICS: DynamicsClass = 'normal'

function buildMeasures(count: number, timeSignature: TimeSignature): readonly GrooveMeasure[] {
  invariant(Number.isInteger(count) && count > 0, `groove needs at least one measure, got ${count}`)
  const barTicks = measureDurationTicks(timeSignature)
  const measures: GrooveMeasure[] = []
  let startTick = 0
  for (let i = 0; i < count; i++) {
    measures.push({ index: i, startTick: ticks(startTick), durationTicks: barTicks })
    startTick += barTicks
  }
  return measures
}

function measureIndexAtTick(measures: readonly GrooveMeasure[], tick: number): number {
  for (const m of measures) {
    if (tick >= m.startTick && tick < m.startTick + m.durationTicks) return m.index
  }
  return -1
}

function buildNotes(
  inputs: readonly GrooveNoteInput[],
  measures: readonly GrooveMeasure[],
): readonly GrooveNote[] {
  const placed = inputs.map((n) => {
    invariant(
      Number.isInteger(n.tick) && n.tick >= 0,
      `groove note tick must be a whole tick >= 0, got ${n.tick}`,
    )
    invariant(
      Number.isInteger(n.durationTicks) && n.durationTicks > 0,
      `groove note durationTicks must be a positive whole tick, got ${n.durationTicks}`,
    )
    const measureIndex = measureIndexAtTick(measures, n.tick)
    invariant(measureIndex >= 0, `groove note at tick ${n.tick} lies outside every measure`)
    const measure = at(measures, measureIndex)
    invariant(
      n.tick + n.durationTicks <= measure.startTick + measure.durationTicks,
      `groove note at tick ${n.tick} runs past the end of measure ${measureIndex} — drums are onsets, shorten the display duration instead of tying across a barline`,
    )
    const voice = voiceOf(n.pad)
    invariant(voice !== undefined, `groove note pad "${n.pad}" has no known voice`)
    const articulations = n.articulations ?? []
    for (const a of articulations) {
      invariant(isArticulation(a), `unknown articulation: ${a}`)
    }
    if (n.sticking !== undefined) invariant(isSticking(n.sticking), `unknown sticking: ${n.sticking}`)
    return {
      pad: n.pad,
      tick: ticks(n.tick),
      durationTicks: ticks(n.durationTicks),
      voice,
      dynamics: n.dynamics ?? DEFAULT_DYNAMICS,
      articulations,
      ...(n.sticking === undefined ? {} : { sticking: n.sticking }),
      measureIndex,
    }
  })
  placed.sort((a, b) => a.tick - b.tick || padOrderIndex(a.pad) - padOrderIndex(b.pad))
  return assignIds(placed)
}

function noteId(note: { readonly measureIndex: number; readonly pad: string; readonly tick: number }): string {
  return `g${note.measureIndex}.${note.pad}.${note.tick}`
}

function assignIds(notes: readonly Omit<GrooveNote, 'id'>[]): readonly GrooveNote[] {
  const seen = new Map<string, number>()
  return notes.map((n) => {
    const base = noteId(n)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return { ...n, id: count === 1 ? base : `${base}#${count}` }
  })
}

/**
 * Validate, sort and assign ids. Throws `InvariantError` on input that cannot
 * describe a real groove; the returned `GrooveScore` always passes
 * `validateGrooveScore`.
 */
export function makeGrooveScore(input: GrooveScoreInput): GrooveScore {
  invariant(input.id.length > 0, 'groove score id must not be empty')
  const timeSignature = input.timeSignature ?? DEFAULT_TIME_SIGNATURE
  const swingPercent = input.swingPercent ?? DEFAULT_SWING_PERCENT
  invariant(
    Number.isInteger(swingPercent) && swingPercent >= 50 && swingPercent <= 75,
    `swingPercent must be a whole percent 50..75, got ${swingPercent}`,
  )
  const measures = buildMeasures(input.measureCount, timeSignature)
  const notes = buildNotes(input.notes, measures)
  const score: GrooveScore = {
    id: input.id,
    title: input.title ?? '',
    timeSignature,
    swingPercent,
    measures,
    notes,
  }
  const checked = validateGrooveScore(score)
  if (!checked.ok) invariant(false, checked.error)
  return score
}

// ------------------------------------------------------------------ validation

/** The same power-of-two check `core/notation/score.ts` enforces, kept local rather
 * than importing a private helper — see the module doc on the DR-04/notation boundary. */
function isPowerOfTwo(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && 2 ** Math.round(Math.log2(n)) === n
}

function timeSignatureComplaint(ts: TimeSignature): string | undefined {
  if (!Number.isInteger(ts.beats) || ts.beats <= 0) return 'an invalid time signature'
  if (!Number.isInteger(ts.beatType) || ts.beatType <= 0) return 'an invalid time signature'
  if (!isPowerOfTwo(ts.beatType)) return `beat type ${ts.beatType}, which is not a power of two`
  return undefined
}

export function validateGrooveScore(score: GrooveScore): Result<GrooveScore, string> {
  if (score.id.length === 0) return err('groove score id must not be empty')
  if (score.measures.length === 0) return err('groove score has no measures')

  const metreComplaint = timeSignatureComplaint(score.timeSignature)
  if (metreComplaint !== undefined) return err(`groove score has ${metreComplaint}`)
  if (
    !Number.isInteger(score.swingPercent) ||
    score.swingPercent < 50 ||
    score.swingPercent > 75
  ) {
    return err(`groove score swingPercent must be a whole percent 50..75, got ${score.swingPercent}`)
  }

  let expectedStart = 0
  const barTicks = measureDurationTicks(score.timeSignature)
  for (let i = 0; i < score.measures.length; i++) {
    const m = at(score.measures, i)
    if (m.index !== i) return err(`measure at position ${i} carries index ${m.index}`)
    if (m.startTick !== expectedStart) {
      return err(
        `measure ${i} starts at tick ${m.startTick}, expected ${expectedStart} — measures must be contiguous from tick 0`,
      )
    }
    if (m.durationTicks !== barTicks) {
      return err(`measure ${i} has duration ${m.durationTicks}, expected a full bar (${barTicks})`)
    }
    expectedStart += m.durationTicks
  }

  const ids = new Set<string>()
  for (let i = 0; i < score.notes.length; i++) {
    const n = at(score.notes, i)
    for (const a of n.articulations) {
      if (!isArticulation(a)) return err(`note ${n.id} has an unknown articulation: ${String(a)}`)
    }
    if (n.sticking !== undefined && !isSticking(n.sticking)) {
      return err(`note ${n.id} has an unknown sticking: ${String(n.sticking)}`)
    }
    if (!Number.isInteger(n.tick) || n.tick < 0) return err(`note ${n.id} has an invalid tick`)
    if (!Number.isInteger(n.durationTicks) || n.durationTicks <= 0) {
      return err(`note ${n.id} has a non-positive duration`)
    }
    const expectedVoice = voiceOf(n.pad)
    if (expectedVoice === undefined || n.voice !== expectedVoice) {
      return err(`note ${n.id} has voice ${n.voice}, but pad ${n.pad} must be ${String(expectedVoice)}`)
    }
    if (ids.has(n.id)) return err(`duplicate note id: ${n.id}`)
    ids.add(n.id)
    if (i > 0) {
      const prev = at(score.notes, i - 1)
      const prevKey = padOrderIndex(prev.pad)
      const curKey = padOrderIndex(n.pad)
      if (prev.tick > n.tick || (prev.tick === n.tick && prevKey > curKey)) {
        return err(`notes must be sorted by tick then pad order (index ${i} breaks the order)`)
      }
    }
    const measure = score.measures[n.measureIndex]
    if (measure === undefined) return err(`note ${n.id} references missing measure ${n.measureIndex}`)
    const measureEnd = measure.startTick + measure.durationTicks
    if (n.tick < measure.startTick || n.tick >= measureEnd) {
      return err(`note ${n.id} starts at ${n.tick}, outside measure ${n.measureIndex}`)
    }
    if (n.tick + n.durationTicks > measureEnd) {
      return err(`note ${n.id} runs to ${n.tick + n.durationTicks}, past the end of measure ${n.measureIndex}`)
    }
  }
  return ok(score)
}

// ---------------------------------------------------------------------- queries

export function notesInMeasure(score: GrooveScore, measureIndex: number): readonly GrooveNote[] {
  const m = score.measures[measureIndex]
  if (m === undefined) return []
  const end = m.startTick + m.durationTicks
  return score.notes.filter((n) => n.tick >= m.startTick && n.tick < end)
}
