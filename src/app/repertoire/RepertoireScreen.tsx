/**
 * The repertoire library screen (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4) — a thin
 * view over `useRepertoire`: it renders "my pieces" (with a review-due badge
 * per REQ-3.8.4), lets the learner add the score currently open in the score
 * screen, change a piece's status and notes, and browse the graded catalogue
 * as a searchable, level-grouped library.
 *
 * Roadmap UI-18: redesigned from the 2026-08-12 UI audit's worst-screen
 * finding — every catalogue row concatenated title + attribution + level with
 * no separators ("Au Clair de la LuneTraditional...Level 1"), rendered as 40
 * bullets with Add buttons at 40 different x-positions, and "Review due" had
 * no visual distinction from the rest of the screen. The data already had
 * separate title/composer/level fields (see `PieceRow`/`CatalogueRow` below,
 * unchanged in that respect) — the concatenation was a layout defect, not a
 * data one: the fields rendered as sibling inline `<span>`s with no layout
 * rule forcing them onto their own line or apart, so they visually ran
 * together despite being separate DOM nodes. This version puts title,
 * attribution and level into distinct block-level rows/columns, adds a level
 * group header per catalogue section, and adds a client-side search over
 * title/composer (`useRepertoire`'s new `catalogueQuery`/`filteredCatalogue`).
 *
 * Every aria-label/role, class name and exact-text contract an existing e2e
 * spec reads off this screen (`e2e/repertoire*.spec.ts`,
 * `e2e/m4-acceptance-repertoire*.spec.ts`, `e2e/empty-state-starting-actions.spec.ts`)
 * is preserved: the "Repertoire"/"Review due"/"Graded library" region names,
 * the "Repertoire pieces"/"Pieces due for review"/"Graded pieces" list names,
 * the "Level"/"Status"/"Notes" labels, the "Add loaded score"/"Add"/"Open in
 * Practice" button names, the `.repertoire-catalogue-provenance` class, and
 * the exact empty-state strings — only the visual layout around them changed.
 */
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import { REPERTOIRE_STATUSES, type RepertoirePiece, type RepertoireStatus } from '@core/repertoire/repertoire.ts'
import { PROVENANCE_LABELS, type GradedPiece } from '@content/repertoire/gradedPieces.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { useMemo, useState } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { useRepertoire } from './useRepertoire.ts'

const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i)

/** Level number -> the curriculum's own short label for it ("Level 1 —
 *  Beginner"), read straight off `@content/curriculum/curriculum.ts` — never
 *  invented here. Falls back to a bare "Level N" for a level number the
 *  curriculum doesn't (yet) name, which should not happen for 1–5 but keeps
 *  this honest if the two content lists ever drift. */
const LEVEL_TITLES: ReadonlyMap<number, string> = new Map(
  CURRICULUM.levels.map((level) => [level.number, level.title]),
)
function levelHeading(level: number): string {
  return LEVEL_TITLES.get(level) ?? `Level ${level}`
}

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

  const dueIds = useMemo(() => new Set(repertoire.due.map((p) => p.id)), [repertoire.due])

  // REQ-5.2/roadmap 5.3: "below the learner's current level, not at it" — the
  // 40 Piece Challenge shape the catalogue was widened toward. Strictly below,
  // so a level-1 learner (nothing exists below level 1) correctly sees none.
  // Layered on top of the hook's own search filter (roadmap UI-18): search
  // narrows first, then this narrows further, so typing a query while the
  // toggle is on searches only the below-level slice.
  const visibleCatalogue = belowLevelOnly
    ? repertoire.filteredCatalogue.filter((piece) => piece.level < repertoire.playingLevel)
    : repertoire.filteredCatalogue

  const hasQuery = repertoire.catalogueQuery.trim() !== ''

  const addDisabledReason =
    repertoire.loadedScoreTitle === undefined
      ? 'Load a score first to add it to your repertoire.'
      : repertoire.loadedScoreAlreadyAdded
        ? 'This score is already in your repertoire.'
        : undefined

  return (
    <section className="page page--wide repertoire-screen" role="region" aria-label="Repertoire">
      <div className="page-header">
        <h1>Repertoire</h1>
        <p className="page-header-subtitle">Pieces graded to your level — add them to practice</p>
      </div>

      <div className="card--sunken repertoire-add">
        <div className="field-inline">
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
        </div>
        <button
          type="button"
          className="btn-ghost"
          disabled={addDisabledReason !== undefined}
          onClick={() => repertoire.addLoadedScore(level)}
        >
          Add loaded score
        </button>
        {addDisabledReason !== undefined && (
          <p className="repertoire-add-hint">{addDisabledReason}</p>
        )}
        {repertoire.addError !== undefined && <p role="alert">{repertoire.addError}</p>}
      </div>

      {/* "My pieces" — the first section (roadmap UI-18): the learner's own
          library, each row carrying a review-due badge inline rather than
          leaving "due" as a fact the learner has to cross-reference against a
          separate list. The separate named "Review due" region below still
          exists in full (e2e/repertoire.spec.ts reads it by name), now nested
          as a compact second view onto the same data rather than a visually
          identical sibling section. */}
      <section className="card repertoire-my-pieces">
        <h2>My pieces</h2>
        {repertoire.pieces.length === 0 ? (
          <div className="empty-state">
            <Icon name="book" />
            <p>No pieces in your library yet — add the score you have loaded above.</p>
          </div>
        ) : (
          <ul className="repertoire-list" aria-label="Repertoire pieces">
            {repertoire.pieces.map((piece) => (
              <PieceRow
                key={piece.id}
                piece={piece}
                daysSince={repertoire.daysSince(piece)}
                isDue={dueIds.has(piece.id)}
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
            <>
              <p>Nothing due for review.</p>
              <p className="repertoire-due-hint">
                Set a piece to &ldquo;maintained&rdquo; above to start tracking it here.
              </p>
            </>
          ) : (
            <ul className="repertoire-due-list" aria-label="Pieces due for review">
              {repertoire.due.map((piece) => (
                <li key={piece.id} className="repertoire-due-item">
                  <Icon name="clock" />
                  <span>
                    {piece.title} — {daysSinceText(repertoire.daysSince(piece))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      {/* REQ-5.2/REQ-3.8.3, roadmap 4.9a/UI-18: the shipped graded catalogue,
          browsable as a searchable, level-grouped library and added one piece
          at a time — see `addFromCatalogue`'s doc comment on why this is
          deliberately not a bulk "add all" control. */}
      {/* Catalogue add failures (duplicate id, cap reached) surface in the
          shared alert above, inside .repertoire-add — there is no separate
          per-row error display. */}
      <section className="repertoire-catalogue" role="region" aria-label="Graded library">
        <div className="section-header">
          <h2>Library</h2>
        </div>

        <div className="toolbar repertoire-catalogue-filters">
          <div className="field-inline repertoire-catalogue-search-field">
            <label htmlFor="repertoire-search">Search</label>
            <input
              id="repertoire-search"
              type="search"
              placeholder="Title or composer"
              value={repertoire.catalogueQuery}
              onChange={(e) => repertoire.setCatalogueQuery(e.target.value)}
            />
          </div>
          <label className="repertoire-catalogue-filter">
            <input
              type="checkbox"
              checked={belowLevelOnly}
              onChange={(e) => setBelowLevelOnly(e.target.checked)}
            />
            Below my level (playing level {repertoire.playingLevel})
          </label>
        </div>

        {visibleCatalogue.length === 0 ? (
          <p>
            {hasQuery
              ? `No pieces match "${repertoire.catalogueQuery.trim()}".`
              : `No catalogue pieces below level ${repertoire.playingLevel} yet.`}
          </p>
        ) : (
          <ul className="repertoire-catalogue-list" aria-label="Graded pieces">
            {LEVELS.flatMap((groupLevel) => {
              const atLevel = visibleCatalogue.filter((piece) => piece.level === groupLevel)
              if (atLevel.length === 0) return []
              return [
                <li key={`level-${groupLevel}`} className="repertoire-level-header">
                  {levelHeading(groupLevel)}
                </li>,
                ...atLevel.map((piece) => (
                  <CatalogueRow
                    key={piece.id}
                    piece={piece}
                    alreadyAdded={repertoire.catalogueAddedIds.has(piece.id)}
                    onAdd={() => repertoire.addFromCatalogue(piece.id)}
                  />
                )),
              ]
            })}
          </ul>
        )}
      </section>
    </section>
  )
}

type PieceRowProps = {
  readonly piece: RepertoirePiece
  readonly daysSince: number | null
  readonly isDue: boolean
  readonly canOpenInPractice: boolean
  readonly onStatusChange: (status: RepertoireStatus) => void
  readonly onNotesChange: (notes: string) => void
  readonly onOpenInPractice: () => void
}

function PieceRow({
  piece,
  daysSince,
  isDue,
  canOpenInPractice,
  onStatusChange,
  onNotesChange,
  onOpenInPractice,
}: PieceRowProps) {
  const statusId = `repertoire-status-${piece.id}`
  const notesId = `repertoire-notes-${piece.id}`

  return (
    <li className="repertoire-piece">
      <div className="repertoire-piece-heading">
        <span className="repertoire-piece-title">{piece.title}</span>
        <span className="badge repertoire-piece-level">Level {piece.level}</span>
        <span className="badge">{piece.status}</span>
        {isDue && (
          <span className="badge repertoire-piece-due-badge">
            <Icon name="clock" /> Review due
          </span>
        )}
      </div>

      <p className="repertoire-piece-practice">{daysSinceText(daysSince)}</p>

      <div className="field-row repertoire-piece-controls">
        <div className="field">
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
        </div>

        <div className="field repertoire-piece-notes">
          <label htmlFor={notesId}>Notes</label>
          <textarea id={notesId} value={piece.notes} onChange={(e) => onNotesChange(e.target.value)} />
        </div>

        {/* Only pieces added from the graded catalogue resolve to a bundled
            score file — see `canOpenInPractice`'s doc comment. A piece added
            via "Add loaded score" gets no control here rather than a
            disabled/no-op one, per this module's existing convention (see the
            catalogue list's Add/Already-in-library split below). */}
        {canOpenInPractice && (
          <button type="button" className="btn-ghost" onClick={onOpenInPractice}>
            Open in Practice
          </button>
        )}
      </div>
    </li>
  )
}

type CatalogueRowProps = {
  readonly piece: GradedPiece
  readonly alreadyAdded: boolean
  readonly onAdd: () => void
}

/**
 * The catalogue row itself — roadmap UI-18's fix for the audit's worst
 * finding. Title, composer and level were ALREADY separate `<span>`s before
 * this task; what was missing was a layout rule putting them on distinct
 * lines/columns instead of letting inline flow run them together. Title sits
 * at `--text-md`/`--text-1`, composer below it at `--text-sm`/`--text-2`
 * (`.repertoire-catalogue-info`, feature-repertoire.css), the level badge and
 * Add button sit in their own fixed-width trailing columns so every row's Add
 * button lines up under the last, regardless of how long the title/composer
 * text runs.
 */
function CatalogueRow({ piece, alreadyAdded, onAdd }: CatalogueRowProps) {
  return (
    <li className="repertoire-catalogue-piece">
      <div className="repertoire-catalogue-info">
        <span className="repertoire-catalogue-title">{piece.title}</span>
        <span className="repertoire-catalogue-composer">{piece.composer}</span>
        <span className="repertoire-catalogue-provenance">{provenanceText(piece)}</span>
      </div>
      <span className="badge repertoire-catalogue-level">Level {piece.level}</span>
      <div className="repertoire-catalogue-action">
        {alreadyAdded ? (
          <span className="repertoire-catalogue-added">Already in your library</span>
        ) : (
          <button type="button" className="btn-ghost" onClick={onAdd}>
            Add
          </button>
        )}
      </div>
    </li>
  )
}
