/**
 * Hi-hat foot drills (roadmap DR-15 "coordination trainer"): the exercise
 * that moves timekeeping off the hand hi-hat and onto the ride, puts the
 * foot on the hi-hat pedal on every even-numbered beat (2, 4, 6…), and then
 * builds the rest of the groove back up underneath that foundation.
 *
 * Three cumulative steps, in fixed order — ride + pedal, then the kick
 * joins, then the snare-family voices join last — mirroring `layers.ts`'s
 * own "cymbals, then feet, then snare" build order, but with the pedal
 * pulled out of the feet group and folded into step 1 instead: the pedal
 * IS the new timekeeper here, so it belongs with the ride, not waiting for
 * the kick. A group that contributes no notes is skipped outright (its step
 * is not emitted) rather than repeating the previous step's content under a
 * new title — see `hhFootDrills`'s own doc comment.
 */
import { makeGrooveScore, type GrooveNote, type GrooveNoteInput, type GrooveScore } from '@core/drums/model/groove.ts'
import { beatTicks } from '@core/timing/metronome.ts'
import { layerGroupOf } from './layers.ts'

export type HhFootDrill = { readonly score: GrooveScore }

/** Carries a note's tick/duration/dynamics/articulations/sticking through to a fresh `GrooveNoteInput`, pad unchanged. */
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
 * A hi-hat note reborn as a ride note: same tick, same duration, dynamics
 * carried over, articulations dropped — an open-hat articulation has no
 * meaning once the note is no longer on the hi-hat. Sticking (a hand-technique
 * fact, not a hi-hat-specific one) still carries over, since the ride is
 * still a hand voice.
 */
function toRideBow(note: GrooveNote): GrooveNoteInput {
  return {
    pad: 'rideBow',
    tick: note.tick,
    durationTicks: note.durationTicks,
    dynamics: note.dynamics,
    ...(note.sticking === undefined ? {} : { sticking: note.sticking }),
  }
}

/**
 * `hhPedal` on every even-numbered beat (2, 4, 6…) of every measure of
 * `groove`: tick `beatTicks * (beatIndex)` from the measure start, where
 * `beatIndex` is the 0-based beat index of an even 1-based beat (1, 3, 5… ->
 * beats 2, 4, 6…) and the beat unit is the time signature's own
 * (`beatTicks` from the metronome: `beatType` decides it, so 6/8 pedals on
 * eighth-note beats 2, 4 and 6, not on a quarter grid). A measure with fewer
 * than 2 beats contributes nothing, and a beat that starts at or past the end
 * of a short (pickup) measure is skipped. Duration is one full beat, which
 * never overlaps the next added pedal note (two beats later).
 */
function footPedalNotes(groove: GrooveScore): readonly GrooveNoteInput[] {
  const beats = groove.timeSignature.beats
  if (beats < 2) return []
  const beatLength = beatTicks(groove.timeSignature)
  const notes: GrooveNoteInput[] = []
  for (const measure of groove.measures) {
    const measureEnd = measure.startTick + measure.durationTicks
    for (let beatIndex = 1; beatIndex < beats; beatIndex += 2) {
      const tick = measure.startTick + beatLength * beatIndex
      if (tick >= measureEnd) break
      notes.push({ pad: 'hhPedal', tick, durationTicks: beatLength })
    }
  }
  return notes
}

function dedupeByPadAndTick(notes: readonly GrooveNoteInput[]): readonly GrooveNoteInput[] {
  const seen = new Set<string>()
  return notes.filter((n) => {
    const key = `${n.pad}@${n.tick}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

type StepGroup = {
  readonly titleSuffix: string
  readonly notes: readonly GrooveNoteInput[]
}

/**
 * The three cumulative build steps described in the module comment. Deterministic;
 * no rng. A group with no notes is skipped entirely — its step is not emitted,
 * and it does not consume a title or an id suffix (the next present group's
 * step gets the next sequential id/title-suffix pairing in the fixed order
 * below, not a renumbered one).
 *
 * Step 1's notes are every cymbal-group note of `groove` (hi-hats swapped for
 * `rideBow`, everything else carried over unchanged) plus the added pedal
 * notes. Step 2 adds the kick (the one other feet-group pad, `hhPedal`
 * already handled). Step 3 adds every snare-family note.
 */
export function hhFootDrills(groove: GrooveScore): readonly HhFootDrill[] {
  const cymbalNotes = groove.notes.filter((n) => layerGroupOf(n.pad) === 'cymbals')
  // A groove that already rides AND plays a hat on the same tick would put
  // two `rideBow` notes on one tick after the swap, which `makeGrooveScore`
  // rightly rejects (one pad, one onset). Keep the first note per pad+tick.
  const transformedCymbalNotes = dedupeByPadAndTick(
    cymbalNotes.map((n) => (n.pad === 'hhClosed' || n.pad === 'hhOpen' ? toRideBow(n) : carryOver(n))),
  )
  const pedalNotes = footPedalNotes(groove)
  const kickNotes = groove.notes.filter((n) => n.pad === 'kick').map(carryOver)
  const snareNotes = groove.notes.filter((n) => layerGroupOf(n.pad) === 'snare').map(carryOver)

  const groups: readonly StepGroup[] = [
    { titleSuffix: 'ride and foot on 2 and 4', notes: [...transformedCymbalNotes, ...pedalNotes] },
    { titleSuffix: 'add the kick', notes: kickNotes },
    { titleSuffix: 'add the snare', notes: snareNotes },
  ]

  const drills: HhFootDrill[] = []
  let cumulative: readonly GrooveNoteInput[] = []
  let stepNumber = 0
  for (const group of groups) {
    if (group.notes.length === 0) continue
    cumulative = [...cumulative, ...group.notes]
    stepNumber += 1
    const score = makeGrooveScore({
      id: `${groove.id}-hhfoot-${stepNumber}`,
      title: `${groove.title} — ${group.titleSuffix}`,
      timeSignature: groove.timeSignature,
      swingPercent: groove.swingPercent,
      swingUnit: groove.swingUnit,
      measureCount: groove.measures.length,
      notes: cumulative,
    })
    drills.push({ score })
  }
  return drills
}
