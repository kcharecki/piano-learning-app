/**
 * The metronome (roadmap 1.11, REQ-3.9.1): configurable tempo, time signature,
 * accent pattern, subdivision, count-in and gradual tempo ramping.
 *
 * This module makes NO sound. It computes *when* a click happens and *what kind*
 * of click it is; the caller feeds those to the `AudioOutput` port. The
 * scheduler asks for the clicks in its next look-ahead window (`clicksInRange`)
 * and hands them to audio with their pre-computed times.
 *
 * Conventions, all deliberate:
 *
 *  - **Ticks are the truth.** The grid is anchored to tick 0 and every position
 *    is an exact integer tick. `ms` is derived through `tempo.ts` (the one place
 *    allowed to know the tick <-> ms conversion) so the metronome and the
 *    transport can never disagree about where beat 3 is.
 *
 *  - **The tempo is a `TempoMap`, not a number.** Hand `settings.tempo` the very
 *    map the transport is playing and the clicks follow written tempo changes
 *    and the practice-tempo scale (REQ-3.2.2) exactly, because both sides call
 *    the same `tickToMs`. A scalar `bpm` alone is a single-tempo straight line:
 *    across an ordinary "crotchet = 120, then 72" change it is already 333 ms
 *    out one bar later, sixteen times the 20 ms budget of REQ-4.1. `bpm` stays
 *    as the convenience constructor for a metronome that is not following a
 *    score (a scales drill, the practice-room click); when `tempo` is present it
 *    is what `ms` comes from and `bpm` is only the number on the dial.
 *
 *  - **`bpm` is quarter-note BPM**, because that is what the `Bpm` brand means
 *    everywhere in the core. It matters where the beat is not a quarter: in 6/8
 *    the beat is an eighth, so `bpm = 120` gives a click every 250 ms (240
 *    eighths/min). Convert at the UI edge, not here.
 *
 *  - **Indices are 0-based**: `bar` 0 is the first bar of the music, `beat` 0 is
 *    the downbeat a musician calls "beat 1", `subdivisionIndex` 0 lands on the
 *    beat. A count-in lives at negative ticks and so in negative bars (-1 is the
 *    bar before the music) — the same backwards extension `tempo.ts` uses.
 *
 *  - **Only on-beat clicks can be accented.** An accent marks the pulse; an
 *    accented off-beat would just be a wrong pulse.
 */
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import {
  bpm as asBpm,
  ticks as asTicks,
  TICKS_PER_QUARTER,
  type Bpm,
  type Millis,
  type Ticks,
} from '@core/shared/units.ts'
import { makeTempoMap, tickToMs, type TempoMap } from './tempo.ts'

/** Clicks per beat. 3 is a triplet subdivision; 6 and 8 are for slow practice. */
export type Subdivision = 1 | 2 | 3 | 4 | 6 | 8
export const SUBDIVISIONS = [1, 2, 3, 4, 6, 8] as const

/** One entry per beat in the bar; `true` = accented. 4/4 default: `[T,F,F,F]`. */
export type AccentPattern = readonly boolean[]

export type MetronomeSettings = {
  /** Quarter-note BPM — see the module note about compound metres. */
  readonly bpm: Bpm
  readonly timeSignature: TimeSignature
  readonly subdivision: Subdivision
  /** Defaults to `defaultAccents(timeSignature)`. Length must equal `beats`. */
  readonly accents?: AccentPattern
  /** Bars of clicks before tick 0. Used by `clicksForBars` only. */
  readonly countInBars?: number
  /**
   * The tempo the clicks are placed against — normally the transport's own map,
   * so the two cannot drift. Written tempo changes and the practice-tempo scale
   * both come from here. Defaults to a single mark of `bpm` at tick 0.
   */
  readonly tempo?: TempoMap
}

export type Click = {
  readonly tick: Ticks
  /** Relative to tick 0, so count-in clicks are negative. */
  readonly ms: Millis
  readonly accented: boolean
  /** 0-based index into the bar's accent pattern; 0 is the downbeat. */
  readonly beat: number
  /** 0-based position inside the beat; 0 is on the beat. */
  readonly subdivisionIndex: number
  /** 0-based; negative during the count-in. */
  readonly bar: number
}

/**
 * Sane range for the *number on the dial* — slower than 20 is not a pulse,
 * faster than 300 is a blur. It is deliberately not the whole check: see
 * `MIN_CLICK_GAP_MS`.
 */
export const MIN_BPM = 20
export const MAX_BPM = 300

/**
 * What the ear actually hears is the gap between clicks, and `bpm` does not
 * determine it: the audible rate is `bpm x (4 / beatType) x subdivision`. Three
 * settings the raw-bpm check waves through:
 *  - 4/4 with subdivision 8 at 300 bpm — a click every 25 ms, barely more than
 *    the whole 20 ms audio budget of REQ-4.1, so the clicks smear into a buzz;
 *  - 6/16 with subdivision 8 at 300 bpm — 6.25 ms, i.e. inside that budget: the
 *    scheduler physically cannot deliver them as separate sounds;
 *  - 4/1 at 20 bpm — one click every 12 s, which no one can keep time against.
 *
 * So the gap is validated too. 50 ms is 20 clicks a second: already the fastest
 * rattle that reads as a rhythm rather than a pitch, and safely clear of the
 * audio budget. 6 s is a whole-note pulse at 40 bpm — the slowest thing a person
 * can still feel as a beat.
 */
export const MIN_CLICK_GAP_MS = 50
export const MAX_CLICK_GAP_MS = 6000

/**
 * Ceiling on the clicks one call may materialise. The scheduler asks for a
 * look-ahead window of a second or two; `clicksForBars(s, 1e7)` is a UI bug, and
 * silently trying to allocate forty million objects turns it into a hung tab
 * instead of an error message. 100k clicks is over two hours of 4/4 at 120.
 */
export const MAX_CLICKS = 100_000

const WHOLE_NOTE_TICKS = TICKS_PER_QUARTER * 4
/** ms in one tick at 1 bpm — `tempo.ts` does the real conversion; this sizes gaps. */
const MS_PER_TICK_AT_1_BPM = 60_000 / TICKS_PER_QUARTER
const NO_CLICKS: readonly Click[] = []

// ------------------------------------------------------------------ the grid

/**
 * Ticks in one metronome beat, i.e. one beat as the time signature writes it:
 * `4/4 -> 480` (quarter), `3/4 -> 480`, `2/2 -> 960` (half), `6/8 -> 240` (eighth).
 *
 * The compound-metre choice: in 6/8 this clicks the *eighth*, six to the bar,
 * not the dotted-quarter conducting pulse. Six clicks is what a student
 * practising 6/8 wants to hear, the felt two-in-a-bar comes back exactly via the
 * accent pattern (beats 1 and 4), and it keeps `accents` meaning "one entry per
 * beat of the time signature" in every metre instead of only in simple ones.
 *
 * Throws for a beat unit that is not tick-exact (`beatType` must divide 1920).
 */
export function beatTicks(ts: TimeSignature): Ticks {
  invariant(
    Number.isInteger(ts.beats) && ts.beats > 0,
    `time signature beats must be a positive integer, got ${ts.beats}`,
  )
  invariant(
    Number.isInteger(ts.beatType) && ts.beatType > 0,
    `time signature beat type must be a positive integer, got ${ts.beatType}`,
  )
  const ticksPerBeat = WHOLE_NOTE_TICKS / ts.beatType
  invariant(
    Number.isInteger(ticksPerBeat),
    `beat unit 1/${ts.beatType} is not tick-exact at ${TICKS_PER_QUARTER} ticks per quarter`,
  )
  return asTicks(ticksPerBeat)
}

/** Shortest denominator whose beats can group: a quarter can, a half cannot. */
const SHORTEST_COMPOUND_BEAT_TYPE = 4

/**
 * Compound metre needs *both* halves of the definition: a beat count divisible
 * by three AND a beat unit short enough that three of them make one dotted beat.
 * A denominator of 8 or 16 always qualifies (6/8, 9/8, 12/8, 6/16); 6/4 is the
 * genuine edge and qualifies too, because three quarters is a dotted half, which
 * is a real conducting unit.
 *
 * 6/2 and 6/1 do NOT: three whole notes is not a beat, it is several seconds of
 * sound, so those are six plain beats with one downbeat. Counting only the beats
 * (`beats % 3 === 0`) would call them compound, which is where this used to be
 * wrong. 3/4 and 3/8 are not compound either — three beats are one group.
 */
function isCompound(ts: TimeSignature): boolean {
  return ts.beats > 3 && ts.beats % 3 === 0 && ts.beatType >= SHORTEST_COMPOUND_BEAT_TYPE
}

/**
 * Irregular metres are *additive*: the bar is a chain of unequal groups and the
 * head of each group carries an accent. The conventional defaults, and the ones
 * a student meets first (Dave Brubeck's "Take Five" in 5/4, most Balkan 7/8):
 *  - 5 -> 3+2, accents on beats 1 and 4
 *  - 7 -> 3+2+2, accents on beats 1, 4 and 6
 *
 * They are only defaults. 2+3 and 2+2+3 are equally real, and a caller that
 * knows the piece passes an explicit `accents` pattern. What is NOT defensible is
 * the old behaviour of seven undifferentiated eighths: a metronome that cannot
 * tell you where the groups are is useless in exactly the metre where you need
 * to be told. Same short-beat condition as compound metre — 5/1 is not additive,
 * it is five very long beats.
 */
const ADDITIVE_GROUPS: ReadonlyMap<number, readonly number[]> = new Map([
  [5, [3, 2]],
  [7, [3, 2, 2]],
])

/** The bar as a chain of group lengths: 4/4 -> [4], 6/8 -> [3,3], 7/8 -> [3,2,2]. */
function beatGroups(ts: TimeSignature): readonly number[] {
  if (isCompound(ts)) return Array.from({ length: ts.beats / 3 }, () => 3)
  const additive =
    ts.beatType >= SHORTEST_COMPOUND_BEAT_TYPE ? ADDITIVE_GROUPS.get(ts.beats) : undefined
  return additive ?? [ts.beats]
}

/**
 * The accent pattern used when the caller does not supply one — one accent per
 * group head: `4/4 -> [T,F,F,F]`, `3/4 -> [T,F,F]`, `6/8 -> [T,F,F,T,F,F]`,
 * `12/8 -> [T,F,F,T,F,F,T,F,F,T,F,F]`, `5/4 -> [T,F,F,T,F]`,
 * `7/8 -> [T,F,F,T,F,T,F]`.
 */
export function defaultAccents(ts: TimeSignature): AccentPattern {
  beatTicks(ts) // validates the signature the same way everything else does
  const heads = new Set<number>()
  let cursor = 0
  for (const group of beatGroups(ts)) {
    heads.add(cursor)
    cursor += group
  }
  return Array.from({ length: ts.beats }, (_, i) => heads.has(i))
}

type Grid = {
  /** Ticks between consecutive clicks. */
  readonly interval: number
  readonly clicksPerBar: number
  readonly subdivision: number
  readonly accents: AccentPattern
  readonly map: TempoMap
}

/**
 * One `Grid` per settings object. `clicksInRange` is on the scheduler's
 * per-frame look-ahead path, and rebuilding the grid meant a fresh `TempoMap`
 * every frame — which also defeated `tempo.ts`'s prefix-sum cache, a WeakMap
 * keyed on the marks array, so it never hit and grew by an entry per call
 * instead. Keyed weakly, so a settings object the UI has dropped is collectable.
 * Settings are `readonly` by type; mutating one behind the cache's back is
 * programmer error and the stale grid is the price.
 */
const gridCache = new WeakMap<MetronomeSettings, Grid>()

function makeGrid(settings: MetronomeSettings): Grid {
  const cached = gridCache.get(settings)
  if (cached !== undefined) return cached
  const grid = buildGrid(settings)
  gridCache.set(settings, grid)
  return grid
}

function buildGrid(settings: MetronomeSettings): Grid {
  const { timeSignature: ts, subdivision } = settings
  invariant(
    Number.isFinite(settings.bpm) && settings.bpm > 0,
    `metronome bpm must be positive, got ${settings.bpm}`,
  )
  invariant(
    Number.isInteger(subdivision) && subdivision > 0,
    `subdivision must be a positive integer, got ${subdivision}`,
  )
  const perBeat = beatTicks(ts)
  const interval = perBeat / subdivision
  invariant(
    Number.isInteger(interval),
    `subdivision ${subdivision} of a ${perBeat}-tick beat is not tick-exact`,
  )
  const accents = settings.accents ?? defaultAccents(ts)
  invariant(
    accents.length === ts.beats,
    `accent pattern has ${accents.length} entries but ${ts.beats}/${ts.beatType} has ${ts.beats} beats`,
  )
  return {
    interval,
    clicksPerBar: ts.beats * subdivision,
    subdivision,
    accents,
    map: settings.tempo ?? makeTempoMap([{ tick: asTicks(0), bpm: settings.bpm }]),
  }
}

/**
 * Index of the first grid click at or after `tick`. The `|| 0` is not
 * decoration: `Math.ceil(-0.001)` is `-0`, which would propagate into `tick` and
 * `bar` and make an otherwise identical click compare unequal under `Object.is`.
 * A window starting just before the downbeat is the normal count-in case.
 */
function ceilIndex(tick: number, interval: number): number {
  return Math.ceil(tick / interval) || 0
}

/** Click number `index` on the infinite grid; negative indices are the count-in. */
function clickAt(grid: Grid, index: number): Click {
  const bar = Math.floor(index / grid.clicksPerBar)
  // Not `%`: JavaScript's remainder is negative for negative indices, and the
  // count-in needs 0..clicksPerBar-1 there too.
  const inBar = index - bar * grid.clicksPerBar
  const beat = Math.floor(inBar / grid.subdivision)
  const subdivisionIndex = inBar - beat * grid.subdivision
  const tick = asTicks(index * grid.interval)
  return {
    tick,
    ms: tickToMs(grid.map, tick),
    accented: subdivisionIndex === 0 && at(grid.accents, beat),
    beat,
    subdivisionIndex,
    bar,
  }
}

/**
 * Clicks whose tick lies in the half-open range `[fromTick, toTick)` — the
 * scheduler's look-ahead query. Half-open is what makes successive windows
 * stitch: `clicksInRange(s, a, b)` followed by `clicksInRange(s, b, c)` yields
 * every click of `clicksInRange(s, a, c)` exactly once, in order.
 *
 * An empty or backwards range yields nothing. Negative ticks are fine and are
 * where the count-in lives. `countInBars` is ignored here: this function answers
 * "what is on the grid between these two ticks", nothing more.
 *
 * Throws rather than allocating when the window holds more than `MAX_CLICKS`.
 */
export function clicksInRange(
  settings: MetronomeSettings,
  fromTick: Ticks,
  toTick: Ticks,
): readonly Click[] {
  invariant(
    Number.isFinite(fromTick) && Number.isFinite(toTick),
    `clicksInRange needs a finite range, got [${fromTick}, ${toTick})`,
  )
  if (toTick <= fromTick) return NO_CLICKS
  const grid = makeGrid(settings)
  const first = ceilIndex(fromTick, grid.interval)
  const end = ceilIndex(toTick, grid.interval)
  invariant(
    end - first <= MAX_CLICKS,
    `range [${fromTick}, ${toTick}) is ${end - first} clicks, over the ${MAX_CLICKS} cap — ` +
      'ask for a shorter window',
  )
  const out: Click[] = []
  for (let i = first; i < end; i++) out.push(clickAt(grid, i))
  return out
}

/**
 * Every click of `bars` bars of music, preceded by `countInBars` bars of count-in
 * at negative ticks. `bars = 0` gives the count-in alone, which is exactly what
 * "count me in, then I play unaccompanied" needs.
 *
 * Bars are whole numbers, and the total is capped by `clicksInRange` at
 * `MAX_CLICKS`: `clicksForBars(s, 1e7)` is an error, not forty million objects.
 *
 * @public — the batch materialiser for the count-in half of REQ-3.9.1 (see the
 * module docstring: "count-in and gradual tempo ramping"). It is the sibling
 * of `clicksInRange`, which is live in production (`app/metronome/useMetronome.ts`,
 * `app/practice/usePracticeEngine.ts`), and the only consumer of
 * `MetronomeSettings.countInBars`, which `validateMetronomeSettings` (also
 * live) already validates. No screen has grown a "count me in" control yet —
 * that is a UI gap, not a reason to delete the core behaviour it depends on.
 */
export function clicksForBars(settings: MetronomeSettings, bars: number): readonly Click[] {
  invariant(Number.isInteger(bars) && bars >= 0, `bars must be a whole number >= 0, got ${bars}`)
  const countInBars = settings.countInBars ?? 0
  invariant(
    Number.isInteger(countInBars) && countInBars >= 0,
    `countInBars must be a whole number >= 0, got ${countInBars}`,
  )
  const barTicks = measureDurationTicks(settings.timeSignature)
  return clicksInRange(settings, asTicks(-countInBars * barTicks), asTicks(bars * barTicks))
}

/**
 * The audible click rate, checked against `MIN_CLICK_GAP_MS..MAX_CLICK_GAP_MS`.
 * With a tempo map the fastest mark sets the shortest gap and the slowest sets
 * the longest, so "this piece speeds up to 200 and my subdivision is 8" is caught
 * before it is heard. Returns the complaint, or `null` when the rate is usable.
 *
 * Assumes the time signature and subdivision have already been checked — it is
 * called from `validateMetronomeSettings` after those, and divides by them.
 */
function clickGapError(settings: MetronomeSettings): string | null {
  const { timeSignature: ts, subdivision, tempo } = settings
  const gapTicks = WHOLE_NOTE_TICKS / ts.beatType / subdivision
  if (tempo !== undefined && tempo.marks.length === 0) return 'tempo map has no marks'
  const played =
    tempo === undefined ? [settings.bpm] : tempo.marks.map((mark) => mark.bpm * tempo.scale)
  const shortest = (gapTicks * MS_PER_TICK_AT_1_BPM) / Math.max(...played)
  const longest = (gapTicks * MS_PER_TICK_AT_1_BPM) / Math.min(...played)
  const rate = `${ts.beats}/${ts.beatType} with subdivision ${subdivision}`
  if (shortest < MIN_CLICK_GAP_MS) {
    return `clicks would be ${round(shortest)} ms apart in ${rate} — at least ${MIN_CLICK_GAP_MS} ms is needed`
  }
  if (longest > MAX_CLICK_GAP_MS) {
    return `clicks would be ${round(longest)} ms apart in ${rate} — at most ${MAX_CLICK_GAP_MS} ms is a pulse`
  }
  return null
}

/** Two decimals at most, without a trailing `.00` — for error messages only. */
function round(ms: number): number {
  return Math.round(ms * 100) / 100
}

/**
 * The non-throwing check for settings that came from the UI. The click functions
 * treat bad settings as programmer error (they throw), so a screen that lets the
 * user type a BPM validates here first.
 */
export function validateMetronomeSettings(
  settings: MetronomeSettings,
): Result<MetronomeSettings, string> {
  const { bpm, timeSignature: ts, subdivision, accents, countInBars } = settings
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    return err(`bpm must be between ${MIN_BPM} and ${MAX_BPM}, got ${bpm}`)
  }
  if (!Number.isInteger(ts.beats) || ts.beats <= 0)
    return err(`bad time signature beats: ${ts.beats}`)
  if (!Number.isInteger(ts.beatType) || ts.beatType <= 0 || WHOLE_NOTE_TICKS % ts.beatType !== 0) {
    return err(`bad time signature beat type: ${ts.beatType}`)
  }
  if (!SUBDIVISIONS.includes(subdivision)) return err(`unsupported subdivision: ${subdivision}`)
  if ((WHOLE_NOTE_TICKS / ts.beatType) % subdivision !== 0) {
    return err(`subdivision ${subdivision} does not divide a beat of ${ts.beats}/${ts.beatType}`)
  }
  const gapError = clickGapError(settings)
  if (gapError !== null) return err(gapError)
  if (accents !== undefined && accents.length !== ts.beats) {
    return err(`accent pattern has ${accents.length} entries but needs ${ts.beats}`)
  }
  if (countInBars !== undefined && (!Number.isInteger(countInBars) || countInBars < 0)) {
    return err(`countInBars must be a whole number >= 0, got ${countInBars}`)
  }
  return ok(settings)
}

// ---------------------------------------------------------------- tempo ramp

/**
 * Gradual tempo ramping (REQ-3.9.1): "+2 BPM per clean repetition". Generalised
 * to +`stepBpm` every `repsPerStep` clean repetitions, because the useful drill
 * is usually "two clean passes, then push".
 */
export type RampSettings = {
  readonly startBpm: Bpm
  readonly targetBpm: Bpm
  readonly stepBpm: number
  readonly repsPerStep: number
}

export type RampState = {
  readonly currentBpm: Bpm
  /** Clean repetitions banked at `currentBpm`; always < `repsPerStep`. */
  readonly repsAtCurrent: number
  /** `currentBpm` has reached `targetBpm` — the ramp is finished and frozen. */
  readonly done: boolean
}

function checkRamp(settings: RampSettings): void {
  invariant(
    Number.isFinite(settings.startBpm) && settings.startBpm > 0,
    `ramp startBpm must be positive, got ${settings.startBpm}`,
  )
  invariant(
    Number.isFinite(settings.targetBpm) && settings.targetBpm > 0,
    `ramp targetBpm must be positive, got ${settings.targetBpm}`,
  )
  invariant(
    Number.isFinite(settings.stepBpm) && settings.stepBpm > 0,
    `ramp stepBpm must be positive, got ${settings.stepBpm}`,
  )
  invariant(
    Number.isInteger(settings.repsPerStep) && settings.repsPerStep >= 1,
    `ramp repsPerStep must be an integer >= 1, got ${settings.repsPerStep}`,
  )
}

/**
 * The state at the beginning of the drill. A start at or above the target is
 * already `done` (and is clamped to the target rather than played faster than
 * asked).
 */
export function startRamp(settings: RampSettings): RampState {
  checkRamp(settings)
  const currentBpm = Math.min(settings.startBpm, settings.targetBpm)
  return {
    currentBpm: asBpm(currentBpm),
    repsAtCurrent: 0,
    done: currentBpm >= settings.targetBpm,
  }
}

/**
 * Fold one repetition into the ramp.
 *
 * A clean repetition banks a rep; the `repsPerStep`-th one raises the tempo by
 * `stepBpm` — never past `targetBpm`, which is hit exactly — and resets the
 * counter. A failed repetition resets the counter *without* lowering the tempo:
 * the point of the drill is "earn the next notch", not "lose the notch you
 * earned". Once `done`, the state is frozen and further repetitions change
 * nothing.
 */
export function advanceRamp(
  settings: RampSettings,
  state: RampState,
  cleanRepetition: boolean,
): RampState {
  checkRamp(settings)
  if (state.done) return state
  if (!cleanRepetition) return { ...state, repsAtCurrent: 0 }

  const reps = state.repsAtCurrent + 1
  if (reps < settings.repsPerStep) return { ...state, repsAtCurrent: reps }

  const nextBpm = Math.min(state.currentBpm + settings.stepBpm, settings.targetBpm)
  return { currentBpm: asBpm(nextBpm), repsAtCurrent: 0, done: nextBpm >= settings.targetBpm }
}
