/**
 * `GrooveScore` <-> subdivision grid (DR-04) — the editor's (DR-13) and the
 * grid-style trainer displays' native shape: rows = pads, columns = 8th/16th/
 * triplet cells.
 *
 * **The grid<->score bridge in this file always works in NOMINAL (straight)
 * ticks** — same design decision as `GrooveScore.swingPercent`'s doc: swing
 * is performance metadata, never baked into a note's `tick`. `gridToScore`
 * therefore places every cell at its straight position regardless of the
 * grid's `swingPercent`, and `scoreToGrid` looks notes up against that same
 * straight grid, not a swung one. This is what makes a plain "straight
 * eighths + swingPercent 66" score — written the normal way a human or a
 * notation import would produce — enter `scoreToGrid` cleanly: the tick
 * lookup was never swung in the first place, so there is nothing for the
 * note's straight ticks to mismatch.
 *
 * `subdivisionCellTicks`/`subdivisionCellTick` (below) compute the SWUNG
 * position of a cell — not used by `gridToScore`/`scoreToGrid` at all
 * anymore, but kept exported for DR-06's future playback feature, which is
 * exactly where "where does this straight-notated cell actually sound"
 * belongs: at playback time, not at notation time.
 *
 * The grid is always representable as a score as far as the GRID's own shape
 * goes, but `gridToScore` still returns a `Result`: a well-formed `GrooveGrid`
 * can carry an invalid `swingPercent`/`swingUnit` pair or a `cellsPerMeasure`
 * inconsistent with its `timeSignature`, and building a `GrooveScore` from
 * that is a real, reportable failure, not a programmer error. A score is
 * representable as a grid only when every note lands exactly on one of the
 * grid's straight tick positions and no two notes on the same pad share a
 * cell (`scoreToGrid` returns `Err` naming the offending note otherwise).
 * "Round-trip identity for any grid-representable score" (the spec's
 * phrasing) means: build a grid, project it to a score, project that back to
 * a grid — same grid. `grid.test.ts`'s property test drives exactly that
 * direction; it does not claim an ARBITRARY `GrooveScore` survives the trip,
 * only one built from a grid in the first place.
 *
 * Swing (`subdivisionCellTick`) is "MPC-style" pairwise swing, applied at the
 * cell level and restarting at every MEASURE boundary: within each measure,
 * cells (0,1) are a pair, (2,3) the next, and so on — pairing is always
 * relative to the measure's own first cell, never a global cell index, so an
 * odd `cellsPerMeasure` (3/8, 5/8, 7/8, 5/16, ...) never lets a pair straddle
 * a barline and swing a downbeat late. A trailing cell left over in an
 * odd-length measure (e.g. cell 6 of a 7-cell 7/8 bar) has no pair partner
 * and is always straight — which falls out of the pairing rule for free: the
 * last cell of an odd-length measure is always an EVEN local index, and only
 * odd local indices are ever delayed. The even (on-beat) cell of a pair sits
 * at its straight position; the odd (off-beat) cell is delayed to
 * `swingPercent`% of the way through the pair's straight-time span. This
 * only makes sense when a beat splits evenly in two — the triplet grid (3
 * cells per beat) is left straight regardless of `swingPercent`, matching
 * how no drummer "swings" an already-tripletized grid.
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { ticks, TICKS_PER_QUARTER, type Ticks } from '@core/shared/units.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import type { Articulation, Sticking } from './articulation.ts'
import { MAPPED_PADS, type MappedDrumPad } from './pad.ts'
import {
  makeGrooveScore,
  type DynamicsClass,
  type GrooveNoteInput,
  type GrooveScore,
  type SwingUnit,
} from './groove.ts'

export type Subdivision = 'eighth' | 'sixteenth' | 'triplet'

/** Grid cells per quarter-note beat — the meter's own beat count times this gives cells/measure. */
const CELLS_PER_BEAT: Readonly<Record<Subdivision, number>> = {
  eighth: 2,
  sixteenth: 4,
  triplet: 3,
}

export type GridCell = {
  readonly dynamics: DynamicsClass
  readonly articulations: readonly Articulation[]
  readonly sticking?: Sticking
}

export type GrooveGridRow = {
  readonly pad: MappedDrumPad
  /** Length `totalCells`; `undefined` where the pad is silent. */
  readonly cells: readonly (GridCell | undefined)[]
}

export type GrooveGrid = {
  readonly subdivision: Subdivision
  readonly timeSignature: TimeSignature
  readonly swingPercent: number
  readonly measureCount: number
  readonly cellsPerMeasure: number
  /** One row per `MAPPED_PADS`, in that canonical order — a stable shape for the editor. */
  readonly rows: readonly GrooveGridRow[]
}

// ------------------------------------------------------------- tick placement

function straightCellTicks(subdivision: Subdivision): Ticks {
  const value = TICKS_PER_QUARTER / CELLS_PER_BEAT[subdivision]
  return ticks(value)
}

/**
 * The tick offset (from score start) of global cell `cellIndex`, for a grid of
 * the given subdivision, swing and `cellsPerMeasureCount` (cells in one
 * measure at this subdivision — from `cellsPerMeasure`). Kept exported for
 * DR-06's future playback feature (see the module doc) — `gridToScore`/
 * `scoreToGrid` no longer call this with a non-straight `swingPercent`.
 *
 * Pairing is measure-local: `cellIndex` is first split into a measure index
 * and a LOCAL cell index (`cellIndex % cellsPerMeasureCount`), and swing
 * pairs the local index, not the global one — see the module doc for why
 * that matters for odd-`cellsPerMeasure` meters.
 */
export function subdivisionCellTick(
  cellIndex: number,
  subdivision: Subdivision,
  swingPercent: number,
  cellsPerMeasureCount: number,
): Ticks {
  const cellsPerBeat = CELLS_PER_BEAT[subdivision]
  const cellTicksStraight = TICKS_PER_QUARTER / cellsPerBeat
  const measureIndex = Math.floor(cellIndex / cellsPerMeasureCount)
  const localIndex = cellIndex - measureIndex * cellsPerMeasureCount
  const measureStartTick = measureIndex * cellsPerMeasureCount * cellTicksStraight
  const straightLocal = localIndex * cellTicksStraight
  if (cellsPerBeat % 2 !== 0 || swingPercent === 50) return ticks(measureStartTick + straightLocal)
  const pairIndex = Math.floor(localIndex / 2)
  const parity = localIndex % 2
  const pairTicksStraight = 2 * cellTicksStraight
  const pairStart = pairIndex * pairTicksStraight
  if (parity === 0) return ticks(measureStartTick + pairStart)
  return ticks(measureStartTick + pairStart + Math.round((pairTicksStraight * swingPercent) / 100))
}

/** `subdivisionCellTick` for cells `0..count-1`, in order — what `grid.test.ts` checks for strict monotonicity. */
export function subdivisionCellTicks(
  count: number,
  subdivision: Subdivision,
  swingPercent: number,
  cellsPerMeasureCount: number,
): readonly Ticks[] {
  const out: Ticks[] = []
  for (let i = 0; i < count; i++) {
    out.push(subdivisionCellTick(i, subdivision, swingPercent, cellsPerMeasureCount))
  }
  return out
}

/** The straight (unswung) tick of global cell `cellIndex` — `subdivisionCellTick` at `swingPercent` 50. */
function nominalCellTick(cellIndex: number, subdivision: Subdivision, cellsPerMeasureCount: number): Ticks {
  return subdivisionCellTick(cellIndex, subdivision, 50, cellsPerMeasureCount)
}

/** Cells in one bar of `timeSignature` at this subdivision, or `undefined` if it does not divide evenly. */
export function cellsPerMeasure(timeSignature: TimeSignature, subdivision: Subdivision): number | undefined {
  const barTicks = measureDurationTicks(timeSignature)
  const cellTicks = straightCellTicks(subdivision)
  return barTicks % cellTicks === 0 ? barTicks / cellTicks : undefined
}

// ------------------------------------------------------------------- score -> grid

/** `undefined` rows default to an all-empty row for that pad. */
export function scoreToGrid(score: GrooveScore, subdivision: Subdivision): Result<GrooveGrid, string> {
  const perMeasure = cellsPerMeasure(score.timeSignature, subdivision)
  if (perMeasure === undefined) {
    return err(
      `time signature ${score.timeSignature.beats}/${score.timeSignature.beatType} does not divide evenly into ${subdivision} cells`,
    )
  }
  const measureCount = score.measures.length
  const totalCells = perMeasure * measureCount
  const tickToCell = new Map<number, number>()
  for (let i = 0; i < totalCells; i++) {
    // Always the STRAIGHT grid — see the module doc. `score.swingPercent` is
    // performance metadata carried through below, never used to shift where
    // a note is expected to land.
    tickToCell.set(nominalCellTick(i, subdivision, perMeasure), i)
  }

  const rowByPad = new Map<MappedDrumPad, (GridCell | undefined)[]>(
    MAPPED_PADS.map((pad) => [pad, new Array<GridCell | undefined>(totalCells).fill(undefined)]),
  )

  for (const note of score.notes) {
    const cellIndex = tickToCell.get(note.tick)
    if (cellIndex === undefined) {
      return err(`note ${note.id} at tick ${note.tick} is not aligned to the ${subdivision} grid`)
    }
    const row = rowByPad.get(note.pad)
    if (row === undefined) return err(`note ${note.id} has an unrecognised pad ${note.pad}`)
    if (row[cellIndex] !== undefined) {
      return err(`two notes for pad ${note.pad} land in the same ${subdivision} cell (tick ${note.tick})`)
    }
    row[cellIndex] = {
      dynamics: note.dynamics,
      articulations: note.articulations,
      ...(note.sticking === undefined ? {} : { sticking: note.sticking }),
    }
  }

  const rows: GrooveGridRow[] = MAPPED_PADS.map((pad) => {
    const cells = rowByPad.get(pad)
    return { pad, cells: cells ?? [] }
  })

  return ok({
    subdivision,
    timeSignature: score.timeSignature,
    swingPercent: score.swingPercent,
    measureCount,
    cellsPerMeasure: perMeasure,
    rows,
  })
}

// ------------------------------------------------------------------- grid -> score

export type GrooveGridMeta = { readonly id: string; readonly title?: string }

/**
 * A grid's cells always place at NOMINAL (straight) ticks — see the module
 * doc — so every cell's duration is exactly the nominal cell duration, and
 * that duration always fits the enclosing measure exactly: `cellsPerMeasure`
 * straight cells tile a bar with no remainder by construction
 * (`cellsPerMeasure`'s own divisibility check), so the last cell's straight
 * duration always lands precisely on the barline, never past it. That is
 * what makes this no longer need the barline-clamping this function used to
 * do when cell ticks could be swung late.
 *
 * Still returns a `Result`, not a bare `GrooveScore`: a `GrooveGrid` can
 * carry a `swingPercent` outside 50..75, or a `cellsPerMeasure`/
 * `timeSignature`/`measureCount` combination that is internally
 * inconsistent (e.g. handed in by a caller other than `scoreToGrid`), and
 * `makeGrooveScore` throwing on that is a reportable failure, not a
 * programmer error this function can rule out up front.
 */
export function gridToScore(grid: GrooveGrid, meta: GrooveGridMeta): Result<GrooveScore, string> {
  const nominalDuration = straightCellTicks(grid.subdivision)
  const notes: GrooveNoteInput[] = []
  for (const row of grid.rows) {
    row.cells.forEach((cell, cellIndex) => {
      if (cell === undefined) return
      const tick = nominalCellTick(cellIndex, grid.subdivision, grid.cellsPerMeasure)
      notes.push({
        pad: row.pad,
        tick,
        durationTicks: nominalDuration,
        dynamics: cell.dynamics,
        articulations: cell.articulations,
        ...(cell.sticking === undefined ? {} : { sticking: cell.sticking }),
      })
    })
  }
  // The subdivision IS the swing unit this grid edits at — sixteenth-note
  // grids swing sixteenths, everything else (incl. triplet, which never
  // swings) defaults to eighth, `makeGrooveScore` canonicalises it to
  // 'eighth' anyway whenever `swingPercent` comes out straight.
  const swingUnit: SwingUnit = grid.subdivision === 'sixteenth' ? 'sixteenth' : 'eighth'
  try {
    return ok(
      makeGrooveScore({
        id: meta.id,
        ...(meta.title === undefined ? {} : { title: meta.title }),
        timeSignature: grid.timeSignature,
        swingPercent: grid.swingPercent,
        swingUnit,
        measureCount: grid.measureCount,
        notes,
      }),
    )
  } catch (cause) {
    return err(`could not build a groove from the grid: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
