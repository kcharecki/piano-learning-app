/**
 * `GrooveScore` <-> subdivision grid (DR-04) — the editor's (DR-13) and the
 * grid-style trainer displays' native shape: rows = pads, columns = 8th/16th/
 * triplet cells.
 *
 * The grid is always representable as a score (`gridToScore` never fails); a
 * score is representable as a grid only when every note lands exactly on one
 * of the grid's computed tick positions and no two notes on the same pad
 * share a cell (`scoreToGrid` returns `Err` naming the offending note
 * otherwise). "Round-trip identity for any grid-representable score" (the
 * spec's phrasing) means: build a grid, project it to a score, project that
 * back to a grid — same grid. `groove.test.ts`'s property test drives exactly
 * that direction; it does not claim an ARBITRARY `GrooveScore` survives the
 * trip, only one built from a grid in the first place.
 *
 * Swing is "MPC-style" pairwise swing, applied at the cell level: cells
 * (0,1) are a pair, (2,3) the next, and so on; the even (on-beat) cell of a
 * pair sits at its straight position, the odd (off-beat) cell is delayed to
 * `swingPercent`% of the way through the pair's straight-time span. This only
 * makes sense when a beat splits evenly in two — the triplet grid (3 cells
 * per beat) is left straight regardless of `swingPercent`, matching how no
 * drummer "swings" an already-tripletized grid.
 *
 * Forward tick placement (`subdivisionCellTicks`) is never inverted by
 * algebra — `scoreToGrid` builds its reverse lookup FROM that same forward
 * function, so rounding can never make forward and reverse disagree. The
 * "swing application reversible" property test (`grid.test.ts`) checks the
 * forward function alone: its output is always strictly increasing, i.e.
 * every cell lands on a distinct tick, which is what makes the lookup a true
 * inverse in the first place.
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
 * the given subdivision and swing. Pure, deterministic, and the single
 * definition both `scoreToGrid` (via its reverse lookup) and `gridToScore`
 * use — see the module doc.
 */
export function subdivisionCellTick(
  cellIndex: number,
  subdivision: Subdivision,
  swingPercent: number,
): Ticks {
  const cellsPerBeat = CELLS_PER_BEAT[subdivision]
  const cellTicksStraight = TICKS_PER_QUARTER / cellsPerBeat
  const straight = cellIndex * cellTicksStraight
  if (cellsPerBeat % 2 !== 0 || swingPercent === 50) return ticks(straight)
  const pairIndex = Math.floor(cellIndex / 2)
  const parity = cellIndex % 2
  const pairTicksStraight = 2 * cellTicksStraight
  const pairStart = pairIndex * pairTicksStraight
  if (parity === 0) return ticks(pairStart)
  return ticks(pairStart + Math.round((pairTicksStraight * swingPercent) / 100))
}

/** `subdivisionCellTick` for cells `0..count-1`, in order — what `grid.test.ts` checks for strict monotonicity. */
export function subdivisionCellTicks(
  count: number,
  subdivision: Subdivision,
  swingPercent: number,
): readonly Ticks[] {
  const out: Ticks[] = []
  for (let i = 0; i < count; i++) out.push(subdivisionCellTick(i, subdivision, swingPercent))
  return out
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
    tickToCell.set(subdivisionCellTick(i, subdivision, score.swingPercent), i)
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
 * Always succeeds — a well-formed `GrooveGrid` is always a representable
 * groove. The nominal (straight) cell duration is clamped to the enclosing
 * measure's end tick: a swung off-beat cell in the LAST position of a
 * measure sits late enough (any `swingPercent > 50`) that its straight
 * duration would otherwise run past the barline, which `makeGrooveScore`
 * rejects (drums are onsets — shorten the display duration, per
 * `groove.ts`'s `buildNotes` error, rather than tie across it). Caught by
 * `grid.test.ts`'s round-trip property test generating a hit in every cell.
 */
export function gridToScore(grid: GrooveGrid, meta: GrooveGridMeta): GrooveScore {
  const nominalDuration = straightCellTicks(grid.subdivision)
  const barTicks = measureDurationTicks(grid.timeSignature)
  const notes: GrooveNoteInput[] = []
  for (const row of grid.rows) {
    row.cells.forEach((cell, cellIndex) => {
      if (cell === undefined) return
      const tick = subdivisionCellTick(cellIndex, grid.subdivision, grid.swingPercent)
      const measureEnd = (Math.floor(cellIndex / grid.cellsPerMeasure) + 1) * barTicks
      const durationTicks = Math.min(nominalDuration, measureEnd - tick)
      notes.push({
        pad: row.pad,
        tick,
        durationTicks,
        dynamics: cell.dynamics,
        articulations: cell.articulations,
        ...(cell.sticking === undefined ? {} : { sticking: cell.sticking }),
      })
    })
  }
  return makeGrooveScore({
    id: meta.id,
    ...(meta.title === undefined ? {} : { title: meta.title }),
    timeSignature: grid.timeSignature,
    swingPercent: grid.swingPercent,
    measureCount: grid.measureCount,
    notes,
  })
}
