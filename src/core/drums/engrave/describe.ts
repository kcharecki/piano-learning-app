/**
 * `describeGroove` — the sentence a screen-reader learner hears in place of
 * the rendered percussion staff (`./staff.ts`'s `aria-label`, DR-05). A
 * sighted learner reads noteheads on a staff; this has to carry the same
 * information in words — which limb plays where, including where the
 * hi-hat opens — or the drums trainer is simply unusable without sight.
 * That is why the format below is never allowed to degrade into a summary
 * like "a drum groove in 4/4": a summary throws away exactly the
 * limb-and-position detail the sentence exists to carry.
 *
 * `padLabel` is injected rather than a table kept here, because the
 * learner-facing pad names (`GROOVE_PAD_LABEL` in
 * `src/app/drums/groove/padLabels.ts`) are copy, and copy belongs to the UI
 * layer. Duplicating that table in core would give the app two vocabularies
 * to keep in sync — the same reasoning `voiceOf`/`staffPositionOf` already
 * follow for pad facts that ARE core's job; a display string is not one of
 * those facts.
 *
 * Position naming reuses the count-row vocabulary a learner already reads
 * under the staff: the beat number alone on the beat, then `e`, `&`, `a` for
 * the second, third and fourth sixteenth of that beat. A tick that does not
 * land on that sixteenth grid (never true of the bundled content, but a
 * corrupt or hand-built score is not this module's business to distrust
 * further than this) is named `<beat> +<n> ticks` rather than rounded to the
 * nearest count — rounding would make the sentence claim a position the
 * groove does not actually have.
 *
 * The "every eighth" / "every sixteenth" / "every beat" collapse exists
 * because the alternative — reading out eight or sixteen comma-separated
 * positions for a hi-hat ostinato — is technically correct and practically
 * unusable. The three collapse grids are defined directly off the same
 * beat-subdivision scheme as the count names (beat only / beat+`&` / all
 * four), not as an independent notion of "eighth-note time" — that keeps the
 * collapse test and the position naming reading from one definition instead
 * of two that could disagree in an odd meter.
 */
import { at } from '@core/shared/invariant.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import { padOrderIndex, type MappedDrumPad } from '@core/drums/model/pad.ts'

/** The four named subdivisions of one beat, in order — index 0 is the beat itself (no suffix). */
const SUBDIVISION_NAME = ['', 'e', '&', 'a'] as const

/** Ticks from the start of a measure to the start of one notated beat. */
function beatTicksOf(timeSignature: TimeSignature): number {
  return measureDurationTicks(timeSignature) / timeSignature.beats
}

/**
 * Names a tick's position within its bar using the count-row vocabulary:
 * `1`, `1 e`, `1 &`, `1 a`, `2`, … A tick that lands off that sixteenth grid
 * falls back to `<beat> +<n> ticks` — see the module doc.
 */
function countName(offsetInMeasure: number, beatTicks: number): string {
  const beatIndex = Math.floor(offsetInMeasure / beatTicks)
  const beatNumber = beatIndex + 1
  const withinBeat = offsetInMeasure - beatIndex * beatTicks
  const sixteenthTicks = beatTicks / 4
  const ratio = withinBeat / sixteenthTicks
  if (Number.isInteger(ratio) && ratio >= 0 && ratio < SUBDIVISION_NAME.length) {
    const suffix = at(SUBDIVISION_NAME, ratio)
    return suffix === '' ? `${beatNumber}` : `${beatNumber} ${suffix}`
  }
  return `${beatNumber} +${withinBeat} ticks`
}

/** Every tick, within one bar, that is a multiple of `step` ticks from a beat start. */
function gridOffsets(beats: number, beatTicks: number, step: number): readonly number[] {
  const out: number[] = []
  for (let b = 0; b < beats; b++) {
    for (let t = 0; t < beatTicks; t += step) out.push(b * beatTicks + t)
  }
  return out
}

function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * `'every sixteenth'` / `'every eighth'` / `'every beat'` when a pad's offsets
 * are exactly that grid in EVERY measure (including a measure it is silent
 * in, which by construction can never match) — `undefined` otherwise, which
 * means "list the positions". The three grids are disjoint by size, so at
 * most one can match; check order does not matter.
 */
function collapseLabel(
  timeSignature: TimeSignature,
  beatTicks: number,
  perMeasureOffsets: readonly (readonly number[])[],
): string | undefined {
  const sixteenthTicks = beatTicks / 4
  if (!Number.isInteger(sixteenthTicks)) return undefined
  const grids: readonly [string, readonly number[]][] = [
    ['every sixteenth', gridOffsets(timeSignature.beats, beatTicks, sixteenthTicks)],
    ['every eighth', gridOffsets(timeSignature.beats, beatTicks, sixteenthTicks * 2)],
    ['every beat', gridOffsets(timeSignature.beats, beatTicks, beatTicks)],
  ]
  for (const [label, grid] of grids) {
    if (perMeasureOffsets.every((offsets) => sameOffsets(offsets, grid))) return label
  }
  return undefined
}

/**
 * The `aria-label` sentence for a groove staff. Format:
 * `<title> in <beats>/<beatType>. <Pad>: <positions>. <Pad>: <positions>.`
 *
 * - Title omitted (with its trailing space) when `score.title` is empty, so
 *   the sentence starts `In 4/4.`
 * - Pads appear in `padOrderIndex` order, never insertion/first-hit order.
 * - With more than one measure, a pad that is not silent in some measures
 *   groups its positions per bar as `bar <n>: <positions>`, `; `-separated —
 *   a bar the pad never plays is simply skipped rather than printed empty.
 * - An empty score returns just the title clause, no pad clauses.
 */
export function describeGroove(
  score: GrooveScore,
  padLabel: (pad: MappedDrumPad) => string,
): string {
  const { beats, beatType } = score.timeSignature
  const titleClause =
    score.title.length > 0 ? `${score.title} in ${beats}/${beatType}.` : `In ${beats}/${beatType}.`

  const beatTicks = beatTicksOf(score.timeSignature)
  const measureCount = score.measures.length

  const offsetsByPad = new Map<MappedDrumPad, number[][]>()
  for (const note of score.notes) {
    let perMeasure = offsetsByPad.get(note.pad)
    if (perMeasure === undefined) {
      perMeasure = score.measures.map(() => [])
      offsetsByPad.set(note.pad, perMeasure)
    }
    const measure = at(score.measures, note.measureIndex)
    at(perMeasure, note.measureIndex).push(note.tick - measure.startTick)
  }

  const clauses = [...offsetsByPad.entries()].map(([pad, perMeasureOffsets]) => {
    const collapsed = collapseLabel(score.timeSignature, beatTicks, perMeasureOffsets)
    const positionsText =
      collapsed ??
      perMeasureOffsets
        .map((offsets, measureIndex) => ({ measureIndex, offsets }))
        .filter(({ offsets }) => offsets.length > 0)
        .map(({ measureIndex, offsets }) => {
          const names = offsets.map((offset) => countName(offset, beatTicks)).join(', ')
          return measureCount > 1 ? `bar ${measureIndex + 1}: ${names}` : names
        })
        .join('; ')
    return { pad, text: `${padLabel(pad)}: ${positionsText}.` }
  })
  clauses.sort((a, b) => padOrderIndex(a.pad) - padOrderIndex(b.pad))

  return [titleClause, ...clauses.map((c) => c.text)].join(' ')
}
