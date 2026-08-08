/**
 * Repertoire screen wiring (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4) — the
 * consumer `@core/repertoire/repertoire.ts` and `@app/state/repertoireStore.ts`
 * have never had: every decision about a piece (whether an add is valid, which
 * pieces are due for maintenance, days since last practice) is made by core;
 * this hook only reads the score/repertoire stores and calls through.
 *
 * `addLoadedScore` uses the currently loaded score's OWN id as the piece id
 * (and as `scoreId`), so "is this score already in the library" is just "does
 * a piece with this id exist" — no separate lookup table to keep in sync.
 */
import { useMemo, useState } from 'react'
import type { DateSource } from '@core/ports/index.ts'
import {
  daysSincePractice,
  maintenanceDue,
  type RepertoirePiece,
  type RepertoireStatus,
} from '@core/repertoire/repertoire.ts'
import { GRADED_PIECES, type GradedPiece } from '@content/repertoire/gradedPieces.ts'
import { gradedScoreById, gradedScoreXmlById } from '@content/scores/gradedScoreFiles.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'

export type UseRepertoireOptions = {
  /** Wall-clock reading for "now" — defaults to the real browser clock, exactly as useDashboard does. */
  readonly date?: DateSource
  /** Days after which a 'maintained' piece is due. Passed straight to core `maintenanceDue`. */
  readonly intervalDays?: number
}

export type UseRepertoireResult = {
  readonly pieces: readonly RepertoirePiece[]
  /** Core `maintenanceDue(pieces, now)`, most overdue first. */
  readonly due: readonly RepertoirePiece[]
  /** The loaded score, if any, and whether it is already in the library. */
  readonly loadedScoreTitle: string | undefined
  readonly loadedScoreAlreadyAdded: boolean
  /** Last `addPiece` failure message, or undefined. Cleared by the next successful add. */
  readonly addError: string | undefined
  /** Adds the CURRENTLY LOADED score at the given level. No-op when nothing is loaded. */
  addLoadedScore(level: number): void
  /** The shipped graded catalogue (`GRADED_PIECES`), ascending by level then title. */
  readonly catalogue: readonly GradedPiece[]
  /** Catalogue ids already present in the learner's library. */
  readonly catalogueAddedIds: ReadonlySet<string>
  /**
   * Adds one catalogue piece through the same `addPiece` path a manual add
   * uses. One-at-a-time by design (see the roadmap 4.9a task note): the
   * learner curates their own repertoire (REQ-3.8.x), so this never bulk-
   * inserts the whole catalogue on the learner's behalf. A no-op if `pieceId`
   * is not in `GRADED_PIECES`.
   */
  addFromCatalogue(pieceId: string): void
  setStatus(id: string, status: RepertoireStatus): void
  setNotes(id: string, notes: string): void
  /** Days since last practice, or null — core `daysSincePractice`. */
  daysSince(piece: RepertoirePiece): number | null
  /**
   * True iff `piece.scoreId` names a bundled graded score file — the only
   * pieces `openInPractice` can actually load. A piece added via "Add loaded
   * score" carries its own loaded score's id as `scoreId`, which is never a
   * bundled catalogue file, so this is false for it.
   */
  canOpenInPractice(piece: RepertoirePiece): boolean
  /**
   * Loads `pieceId`'s bundled graded score into `scoreStore`, the same
   * wiring `openDemoScore` uses for a lesson's demo score. A no-op — never
   * throws — when the piece is unknown or `canOpenInPractice` would be false
   * for it.
   */
  openInPractice(pieceId: string): void
}

const defaultDate: DateSource = { epochMillis: () => Date.now() }

export function useRepertoire(options: UseRepertoireOptions = {}): UseRepertoireResult {
  const date = options.date ?? defaultDate
  const intervalDays = options.intervalDays

  const pieces = useRepertoireStore((s) => s.pieces)
  const addPieceToStore = useRepertoireStore((s) => s.addPiece)
  const setStatusInStore = useRepertoireStore((s) => s.setStatus)
  const setNotesInStore = useRepertoireStore((s) => s.setNotes)
  const loaded = useScoreStore((s) => s.loaded)
  const loadScore = useScoreStore((s) => s.loadScore)

  const [addError, setAddError] = useState<string | undefined>(undefined)

  // Same title fallback ScoreScreen.tsx already renders: a blank <title>
  // (no MusicXML <work-title>/<movement-title>) falls back to the import's
  // own file/source name rather than showing nothing.
  const loadedScoreTitle = useMemo(() => {
    if (loaded === undefined) return undefined
    const title = loaded.score.meta.title
    return title.length > 0 ? title : loaded.sourceName
  }, [loaded])

  const loadedScoreAlreadyAdded = useMemo(
    () => loaded !== undefined && pieces.some((p) => p.id === loaded.score.id),
    [loaded, pieces],
  )

  const due = useMemo(
    () =>
      maintenanceDue(
        pieces,
        date.epochMillis(),
        intervalDays === undefined ? {} : { intervalDays },
      ),
    [pieces, date, intervalDays],
  )

  function addLoadedScore(level: number): void {
    if (loaded === undefined) return
    const result = addPieceToStore({
      id: loaded.score.id,
      title: loadedScoreTitle ?? loaded.sourceName,
      composer: loaded.score.meta.composer,
      level,
      scoreId: loaded.score.id,
    })
    setAddError(result.ok ? undefined : result.error)
  }

  function daysSince(piece: RepertoirePiece): number | null {
    return daysSincePractice(piece, date.epochMillis())
  }

  const catalogueAddedIds = useMemo(() => {
    const ids = new Set(pieces.map((p) => p.id))
    return new Set(GRADED_PIECES.filter((p) => ids.has(p.id)).map((p) => p.id))
  }, [pieces])

  function addFromCatalogue(pieceId: string): void {
    const cataloguePiece = GRADED_PIECES.find((p) => p.id === pieceId)
    if (cataloguePiece === undefined) return
    const result = addPieceToStore({
      id: cataloguePiece.id,
      title: cataloguePiece.title,
      composer: cataloguePiece.composer,
      level: cataloguePiece.level,
      ...(cataloguePiece.scoreId === undefined ? {} : { scoreId: cataloguePiece.scoreId }),
    })
    setAddError(result.ok ? undefined : result.error)
  }

  function canOpenInPractice(piece: RepertoirePiece): boolean {
    return piece.scoreId !== undefined && gradedScoreXmlById(piece.scoreId) !== undefined
  }

  function openInPractice(pieceId: string): void {
    const piece = pieces.find((p) => p.id === pieceId)
    if (piece === undefined || !canOpenInPractice(piece)) return
    // canOpenInPractice narrows scoreId to defined but TS can't see that
    // across the function boundary, so re-check here defensively.
    if (piece.scoreId === undefined) return
    const result = gradedScoreById(piece.scoreId)
    if (!result.ok) return
    loadScore({
      score: result.value,
      sourceName: piece.title,
      musicXml: gradedScoreXmlById(piece.scoreId),
    })
  }

  return {
    pieces,
    due,
    loadedScoreTitle,
    loadedScoreAlreadyAdded,
    addError,
    addLoadedScore,
    catalogue: GRADED_PIECES,
    catalogueAddedIds,
    addFromCatalogue,
    setStatus: setStatusInStore,
    setNotes: setNotesInStore,
    daysSince,
    canOpenInPractice,
    openInPractice,
  }
}
