/**
 * Hi-hat opening drills (roadmap DR-15 "coordination trainer"): the exercise
 * that trains the hi-hat foot to open on the upbeat and close it back down on
 * the downbeat — "open on the &, close on 1" — by re-articulating an existing
 * groove's hi-hat part in three cumulative steps, from a single opened "&" up
 * to every "&" in the bar. Every non-hat note carries over unchanged; the
 * hi-hat's own onsets (tick, duration, dynamics, sticking) never move —
 * only which of `hhClosed`/`hhOpen` each one is notated as changes.
 *
 * This mirrors `hhFoot.ts`'s shape (cumulative steps, a group with nothing to
 * contribute is skipped without renumbering) but the axis of progression is
 * different: `hhFoot` builds the groove back up voice by voice, while this
 * drill holds the whole groove fixed and only widens which hats are open.
 */
import { makeGrooveScore, type GrooveNote, type GrooveNoteInput, type GrooveScore } from '@core/drums/model/groove.ts'
import { beatTicks } from '@core/timing/metronome.ts'

export type OpeningDrill = { readonly score: GrooveScore }

/** Carries a note's tick/duration/dynamics/sticking through to a fresh `GrooveNoteInput`, pad unchanged. */
function carryOver(note: GrooveNote): GrooveNoteInput {
  return {
    pad: note.pad,
    tick: note.tick,
    durationTicks: note.durationTicks,
    dynamics: note.dynamics,
    articulations: note.articulations,
    ...(note.sticking === undefined ? {} : { sticking: note.sticking }),
  }
}

/**
 * `note` re-articulated as `hhOpen` (if `open` is true) or `hhClosed`
 * (otherwise). `'open'` is never a free input — `makeGrooveScore` derives it
 * for every `hhOpen` note — so it is stripped from the carried-over
 * articulation list either way; every other articulation carries over as-is.
 */
function reArticulate(note: GrooveNote, open: boolean): GrooveNoteInput {
  const articulations = note.articulations.filter((a) => a !== 'open')
  return {
    pad: open ? 'hhOpen' : 'hhClosed',
    tick: note.tick,
    durationTicks: note.durationTicks,
    dynamics: note.dynamics,
    articulations,
    ...(note.sticking === undefined ? {} : { sticking: note.sticking }),
  }
}

function isHatNote(note: GrooveNote): boolean {
  return note.pad === 'hhClosed' || note.pad === 'hhOpen'
}

/** The tick of the "&" of 1-based beat `b` in `measure`, at `beatLength` ticks per beat. */
function andOfBeatTick(measure: GrooveScore['measures'][number], beatLength: number, beat: number): number {
  return measure.startTick + beatLength * (beat - 1) + beatLength / 2
}

/** Every "&" tick of every beat of every measure of `groove`, in ascending order (with duplicates possible across measures, which is fine — callers compare against a hat's own tick). */
function andTicksByBeat(groove: GrooveScore): ReadonlyMap<number, readonly number[]> {
  const beatLength = beatTicks(groove.timeSignature)
  const beats = groove.timeSignature.beats
  const byBeat = new Map<number, number[]>()
  for (const measure of groove.measures) {
    for (let beat = 1; beat <= beats; beat++) {
      const tick = andOfBeatTick(measure, beatLength, beat)
      const existing = byBeat.get(beat) ?? []
      existing.push(tick)
      byBeat.set(beat, existing)
    }
  }
  return byBeat
}

type Candidate = {
  readonly titleSuffix: string
  readonly openTicks: ReadonlySet<number>
}

function joinBeats(beats: readonly number[]): string {
  return beats.map((b) => String(b)).join(' and ')
}

/**
 * The three candidate steps described in the module comment, in order, for a
 * `beats`-beat bar (only the beat count matters here; the beat unit already
 * went into `andTicksByBeatNum`):
 * open on the & of the last beat; open on the & of every even beat; open on
 * every &. Each candidate's `openTicks` is intersected against the hat ticks
 * that actually sit on an "&" in `groove` (a candidate naming a beat with no
 * hat on its "&" simply contributes nothing for that beat).
 */
function candidateSteps(beats: number, hatAndTicks: ReadonlySet<number>, andTicksByBeatNum: ReadonlyMap<number, readonly number[]>): readonly Candidate[] {
  const lastBeat = beats
  const lastBeatAndTicks = new Set(
    (andTicksByBeatNum.get(lastBeat) ?? []).filter((t) => hatAndTicks.has(t)),
  )
  const evenBeats = Array.from({ length: beats }, (_, i) => i + 1).filter((b) => b % 2 === 0)
  const evenAndTicks = new Set<number>()
  for (const b of evenBeats) {
    for (const t of andTicksByBeatNum.get(b) ?? []) {
      if (hatAndTicks.has(t)) evenAndTicks.add(t)
    }
  }
  const everyAndTicks = new Set(hatAndTicks)

  const candidates: Candidate[] = [
    { titleSuffix: `open on the & of ${lastBeat}`, openTicks: lastBeatAndTicks },
  ]
  if (beats >= 2) {
    candidates.push({
      titleSuffix: `open on the & of ${joinBeats(evenBeats)}`,
      openTicks: evenAndTicks,
    })
  }
  candidates.push({ titleSuffix: 'open on every &', openTicks: everyAndTicks })
  return candidates
}

function sameTickSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false
  for (const t of a) if (!b.has(t)) return false
  return true
}

/**
 * Three cumulative steps re-articulating `groove`'s hi-hat part: open on the
 * & of the last beat, then open on the & of every even beat, then open on
 * every &. `[]` when the groove has no hat sitting exactly on any "&".
 *
 * Every step is the FULL groove: every non-hat note carries over unchanged,
 * and every hat note is re-articulated open or closed according to whether
 * its tick is in that step's open set — including an already-open hat that
 * falls outside the set, which is closed for that step. A candidate whose
 * open set is empty (no hat sits on the beats it names) is skipped, and a
 * candidate whose open-tick set exactly matches the previous EMITTED step's
 * is skipped too, so no step repeats the previous one's content under a new
 * title. Skipping does not renumber ids/titles: `n` counts emitted steps
 * starting at 1.
 */
export function openingDrills(groove: GrooveScore): readonly OpeningDrill[] {
  const hatNotes = groove.notes.filter(isHatNote)
  const andTicksByBeatNum = andTicksByBeat(groove)
  const allAndTicks = new Set<number>()
  for (const ticksForBeat of andTicksByBeatNum.values()) {
    for (const t of ticksForBeat) allAndTicks.add(t)
  }
  const hatAndTicks = new Set(hatNotes.filter((n) => allAndTicks.has(n.tick)).map((n) => n.tick))
  if (hatAndTicks.size === 0) return []

  const nonHatNotes = groove.notes.filter((n) => !isHatNote(n)).map(carryOver)
  const candidates = candidateSteps(groove.timeSignature.beats, hatAndTicks, andTicksByBeatNum)

  const drills: OpeningDrill[] = []
  let previousOpenTicks: ReadonlySet<number> | undefined
  let stepNumber = 0
  for (const candidate of candidates) {
    if (candidate.openTicks.size === 0) continue
    if (previousOpenTicks !== undefined && sameTickSet(candidate.openTicks, previousOpenTicks)) continue
    const reArticulatedHats = hatNotes.map((n) => reArticulate(n, candidate.openTicks.has(n.tick)))
    stepNumber += 1
    const score = makeGrooveScore({
      id: `${groove.id}-open-${stepNumber}`,
      title: `${groove.title} — ${candidate.titleSuffix}`,
      timeSignature: groove.timeSignature,
      swingPercent: groove.swingPercent,
      swingUnit: groove.swingUnit,
      measureCount: groove.measures.length,
      notes: [...nonHatNotes, ...reArticulatedHats],
    })
    drills.push({ score })
    previousOpenTicks = candidate.openTicks
  }
  return drills
}
