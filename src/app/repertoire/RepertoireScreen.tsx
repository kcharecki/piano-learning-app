/**
 * The repertoire library screen (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4) — the
 * screen `@core/repertoire/repertoire.ts` and `@app/state/repertoireStore.ts`
 * have had no consumer for since roadmap 4.5 was ticked years of sessions ago.
 * A thin view over `useRepertoire`: it renders the library, lets the learner
 * add the score currently open in the score screen, change a piece's status
 * and notes, and see which 'maintained' pieces are due for review
 * (REQ-3.8.4) — the section roadmap 4.5's own proof action names.
 */
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import { REPERTOIRE_STATUSES, type RepertoirePiece, type RepertoireStatus } from '@core/repertoire/repertoire.ts'
import { PROVENANCE_LABELS, type GradedPiece } from '@content/repertoire/gradedPieces.ts'
import { useState } from 'react'
import { useRepertoire } from './useRepertoire.ts'

const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i)

/** Rounds to whole days for display — `daysSincePractice` returns a fractional
 * float, and a learner reading "2.34 days" gains nothing over "2 days". */
function daysSinceText(days: number | null): string {
  if (days === null) return 'never practised'
  const whole = Math.round(days)
  return whole === 1 ? '1 day since last practice' : `${whole} days since last practice`
}

/**
 * Roadmap 5.52: the catalogue row used to read "Für Elise (Theme A) /
 * Ludwig van Beethoven (1770–1827) / Level 3 / Add" and disclose nothing
 * about what the bundled file actually is — `src/content/scores/LICENSE.md`
 * and `gradedPieces.ts`'s own doc comment already say, per piece, whether it
 * is a source-verified transcription, a confirmed-shape rendition, a
 * stylistic excerpt, or this app's own rendition. This turns that into one
 * line of learner-facing copy per piece, specific enough that two different
 * pieces read differently (`e2e/repertoire-provenance.spec.ts` asserts
 * exactly that) rather than a generic disclaimer that would be true of every
 * row and prove nothing.
 */
function provenanceText(piece: GradedPiece): string {
  const label = PROVENANCE_LABELS[piece.provenance.tier]
  return piece.provenance.excerptNote === undefined
    ? label
    : `${label} — ${piece.provenance.excerptNote}`
}

export type RepertoireScreenProps = {
  /** Called after `openInPractice` loads a piece's bundled score into
   *  `scoreStore`, so the shell can navigate to Practice — the same split as
   *  `LessonsScreen`'s `onOpenDemo` prop. */
  readonly onOpenInPractice: () => void
}

export function RepertoireScreen({ onOpenInPractice }: RepertoireScreenProps) {
  const repertoire = useRepertoire()
  const [level, setLevel] = useState(MIN_LEVEL)
  const [belowLevelOnly, setBelowLevelOnly] = useState(false)

  // REQ-5.2/roadmap 5.3: "below the learner's current level, not at it" — the
  // 40 Piece Challenge shape the catalogue was widened toward. Strictly below,
  // so a level-1 learner (nothing exists below level 1) correctly sees none.
  const visibleCatalogue = belowLevelOnly
    ? repertoire.catalogue.filter((piece) => piece.level < repertoire.playingLevel)
    : repertoire.catalogue

  const addDisabledReason =
    repertoire.loadedScoreTitle === undefined
      ? 'Load a score first to add it to your repertoire.'
      : repertoire.loadedScoreAlreadyAdded
        ? 'This score is already in your repertoire.'
        : undefined

  return (
    <section className="repertoire-screen" role="region" aria-label="Repertoire">
      <h2>Repertoire</h2>

      <div className="repertoire-add">
        <label htmlFor="repertoire-add-level">Level</label>
        <select
          id="repertoire-add-level"
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={addDisabledReason !== undefined}
          onClick={() => repertoire.addLoadedScore(level)}
        >
          Add loaded score
        </button>
        {addDisabledReason !== undefined && <p>{addDisabledReason}</p>}
        {repertoire.addError !== undefined && <p role="alert">{repertoire.addError}</p>}
      </div>

      {/* Both lists below are given accessible names because the review-due
          section is nested INSIDE this region: without them, "the piece is in
          the library" and "the piece is due for review" are indistinguishable
          to a screen reader and to a test, and an e2e written against the
          unnamed lists failed with an ambiguous match rather than on the
          assertion it was making. */}
      {repertoire.pieces.length === 0 ? (
        <p>No pieces in your library yet — add the score you have loaded above.</p>
      ) : (
        <ul className="repertoire-library repertoire-list" aria-label="Repertoire pieces">
          {repertoire.pieces.map((piece) => (
            <PieceRow
              key={piece.id}
              piece={piece}
              daysSince={repertoire.daysSince(piece)}
              canOpenInPractice={repertoire.canOpenInPractice(piece)}
              onStatusChange={(status) => repertoire.setStatus(piece.id, status)}
              onNotesChange={(notes) => repertoire.setNotes(piece.id, notes)}
              onOpenInPractice={() => {
                repertoire.openInPractice(piece.id)
                onOpenInPractice()
              }}
            />
          ))}
        </ul>
      )}

      <section className="repertoire-due" role="region" aria-label="Review due">
        <h3>Review due</h3>
        {repertoire.due.length === 0 ? (
          <p>Nothing due for review.</p>
        ) : (
          <ul aria-label="Pieces due for review">
            {repertoire.due.map((piece) => (
              <li key={piece.id}>
                {piece.title} — {daysSinceText(repertoire.daysSince(piece))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* REQ-5.2/REQ-3.8.3, roadmap 4.9a: the shipped graded catalogue, added
          one piece at a time — see `addFromCatalogue`'s doc comment on why
          this is deliberately not a bulk "add all" control. */}
      {/* Catalogue add failures (duplicate id, cap reached) surface in the
          shared alert above, inside .repertoire-add — there is no separate
          per-row error display. */}
      <section className="repertoire-catalogue" role="region" aria-label="Graded library">
        <h3>Graded library</h3>
        <label className="repertoire-catalogue-filter">
          <input
            type="checkbox"
            checked={belowLevelOnly}
            onChange={(e) => setBelowLevelOnly(e.target.checked)}
          />
          Below my level (playing level {repertoire.playingLevel})
        </label>
        {belowLevelOnly && visibleCatalogue.length === 0 && (
          <p>No catalogue pieces below level {repertoire.playingLevel} yet.</p>
        )}
        <ul aria-label="Graded pieces">
          {visibleCatalogue.map((piece) => {
            const alreadyAdded = repertoire.catalogueAddedIds.has(piece.id)
            return (
              <li key={piece.id} className="repertoire-catalogue-piece">
                <span className="repertoire-catalogue-title">{piece.title}</span>
                <span className="repertoire-catalogue-composer">{piece.composer}</span>
                <span className="repertoire-catalogue-level">Level {piece.level}</span>
                <span className="repertoire-catalogue-provenance">{provenanceText(piece)}</span>
                {alreadyAdded ? (
                  <span>Already in your library</span>
                ) : (
                  <button type="button" onClick={() => repertoire.addFromCatalogue(piece.id)}>
                    Add
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </section>
  )
}

type PieceRowProps = {
  readonly piece: RepertoirePiece
  readonly daysSince: number | null
  readonly canOpenInPractice: boolean
  readonly onStatusChange: (status: RepertoireStatus) => void
  readonly onNotesChange: (notes: string) => void
  readonly onOpenInPractice: () => void
}

function PieceRow({
  piece,
  daysSince,
  canOpenInPractice,
  onStatusChange,
  onNotesChange,
  onOpenInPractice,
}: PieceRowProps) {
  const statusId = `repertoire-status-${piece.id}`
  const notesId = `repertoire-notes-${piece.id}`

  return (
    <li className="repertoire-piece">
      <span className="repertoire-piece-title">{piece.title}</span>
      <span className="repertoire-piece-composer">{piece.composer}</span>
      <span className="repertoire-piece-level">Level {piece.level}</span>
      <span className="badge">{piece.status}</span>

      <label htmlFor={statusId}>Status</label>
      <select
        id={statusId}
        value={piece.status}
        onChange={(e) => onStatusChange(e.target.value as RepertoireStatus)}
      >
        {REPERTOIRE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>

      <label htmlFor={notesId}>Notes</label>
      <textarea id={notesId} value={piece.notes} onChange={(e) => onNotesChange(e.target.value)} />

      <span className="repertoire-piece-practice">{daysSinceText(daysSince)}</span>

      {/* Only pieces added from the graded catalogue resolve to a bundled
          score file — see `canOpenInPractice`'s doc comment. A piece added
          via "Add loaded score" gets no control here rather than a
          disabled/no-op one, per this module's existing convention (see the
          catalogue list's Add/Already-in-library split above). */}
      {canOpenInPractice && (
        <button type="button" onClick={onOpenInPractice}>
          Open in Practice
        </button>
      )}
    </li>
  )
}
