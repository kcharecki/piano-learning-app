/**
 * The Practice nav destination: import a score or fall back to the bundled
 * sample (roadmap 1.17), then hand off to the practice screen (roadmap 1.18),
 * which renders the notation together with the transport, tempo, loop, hand
 * mute, metronome and wait-mode controls.
 *
 * This screen deliberately owns only the *source* of the score. Everything
 * about playing it belongs to `PracticeScreen`, which also owns the single
 * `ScoreViewer` instance — two viewers would mean two OSMD engravings of the
 * same piece and two cursors disagreeing about the position.
 *
 * UI-09 (2026-08-12 UI audit): the raw file-import row used to be the FIRST
 * thing on screen — chrome before content. The title (and composer, when the
 * loaded score has one) now live in `.page-header`; `ImportPanel` moved into
 * a popover `<dialog>` opened from a secondary "Change piece…" action in the
 * header's action slot, and never renders unprompted at the top again.
 */
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { PracticeScreen } from '@app/practice/PracticeScreen.tsx'
import sampleMusicXml from '@content/scores/twinkle-twinkle-little-star.musicxml?raw'
import { useEffect, useRef, useState } from 'react'
import { AnalysisPanel, useMeasureLabels } from './AnalysisPanel.tsx'
import { ImportPanel } from './ImportPanel.tsx'

const SAMPLE_SCORE_SOURCE_NAME = 'Twinkle, Twinkle, Little Star (bundled sample)'

/** REQ-3.5.5 scopes applied analysis to theory-track levels 4-5. This reads
 *  `>=` rather than the literal `4 || 5` — a deliberate reading of "at levels
 *  4-5" as "from level 4 onward", not a hedge against a level above
 *  `MAX_LEVEL` (`@core/curriculum/types.ts`), which `setLevel` clamps to. */
const MIN_ANALYSIS_THEORY_LEVEL = 4

export function ScoreScreen() {
  const loaded = useScoreStore((s) => s.loaded)
  const loadScore = useScoreStore((s) => s.loadScore)
  const theoryLevel = useLevelStore((s) => s.levelState.levels.theory)
  const levelsHydrated = useLevelStore((s) => s.hydrated)
  // REQ-3.5.5's second half (roadmap 3.18a): the SAME reading the panel below
  // prints, placed under the measure it describes on the engraving itself, so
  // the learner is not mapping "m.3" back to the third bar by eye. One
  // computation feeds both — memoised on the score, above the early return,
  // because `PracticeScreen` re-renders every animation frame while playing.
  const measureLabels = useMeasureLabels(loaded?.score)
  // One gate for both halves of REQ-3.5.5 — the numerals on the engraving and
  // the panel under it appear together or not at all. See the panel's comment
  // below for why the level and the hydration flag are both part of it.
  const showAnalysis = levelsHydrated && theoryLevel >= MIN_ANALYSIS_THEORY_LEVEL

  useEffect(() => {
    if (loaded !== undefined) return
    const result = parseMusicXml(sampleMusicXml)
    if (result.ok) {
      loadScore({
        score: result.value,
        sourceName: SAMPLE_SCORE_SOURCE_NAME,
        musicXml: sampleMusicXml,
      })
    }
  }, [loaded, loadScore])

  // UI-09: the import panel lives in a popover `<dialog>`, opened explicitly
  // from "Change piece…" — never rendered unprompted. `showModal`/`close`
  // driven from state (not the `open` attribute directly) so both the click
  // path and a future programmatic close agree on one source of truth;
  // `dialog.focus()` right after `showModal()` moves focus INTO the dialog
  // (real browsers do this themselves, but consistently enough to depend on
  // only once `tabIndex={-1}` + an explicit focus call make it deterministic)
  // so Escape — handled below for environments that don't wire the native
  // light-dismiss to a bare `keydown`, real browsers do this natively too —
  // and Tab both stay scoped to the dialog's own content.
  const [changePieceOpen, setChangePieceOpen] = useState(false)
  const changePieceButtonRef = useRef<HTMLButtonElement>(null)
  const changePieceDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = changePieceDialogRef.current
    if (dialog === null) return
    if (changePieceOpen && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    } else if (!changePieceOpen && dialog.open) {
      dialog.close()
    }
  }, [changePieceOpen])

  const title =
    loaded === undefined
      ? 'Practice'
      : loaded.score.meta.title.length > 0
        ? loaded.score.meta.title
        : loaded.sourceName
  const composer =
    loaded !== undefined && loaded.score.meta.composer.length > 0
      ? loaded.score.meta.composer
      : undefined

  return (
    <div className="page page--wide score-screen">
      {/* UI-09: title (and composer, when known) in the page header — the
          screen names itself exactly once, per DESIGN.md's screen scaffold. */}
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          {composer !== undefined && <p className="page-header-subtitle">{composer}</p>}
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn-ghost"
            aria-haspopup="dialog"
            ref={changePieceButtonRef}
            onClick={() => setChangePieceOpen(true)}
          >
            Change piece…
          </button>
        </div>
      </div>

      {loaded === undefined && <p>Loading the bundled sample score…</p>}
      {loaded !== undefined && (
        <section aria-label="Score">
          <PracticeScreen
            {...(showAnalysis && measureLabels !== undefined ? { measureLabels } : {})}
          />
          {/* `PracticeScreen` renders `ScoreViewer` only when `musicXml` is
              defined. Every import path now supplies it — a MIDI file is
              engraved from MusicXML written back out of the parsed Score
              (roadmap 2.20) — so this fallback covers only a score loaded
              some future way that genuinely has no notation, and says what is
              missing where the notation would have been rather than above the
              transport, where it was read as a caption and missed. */}
          {loaded.musicXml === undefined && (
            <p>There is no notation to engrave for this score — playback still works.</p>
          )}
          {/* REQ-3.5.5: the roman-numeral analysis of the piece being played,
              under it (roadmap 3.2a), gated to theory level 4+ (roadmap
              3.18) — a level-1 beginner has not met a roman numeral in any
              lesson yet, so showing it here would not "connect theory to
              real music", it would just be noise under their first score.
              Nothing renders in its place below the gate: a placeholder
              would promise a level-up the roadmap has not committed to.
              Also gated on `levelsHydrated`: the level store starts every
              track at 1 and the persisted level is restored asynchronously
              (`persistence.ts`), so reading `theoryLevel` before that
              settles would show nothing and then pop the panel in for a
              level 4-5 learner instead of just rendering it from the start. */}
          {showAnalysis && <AnalysisPanel score={loaded.score} />}
        </section>
      )}

      <dialog
        ref={changePieceDialogRef}
        className="score-change-piece-dialog"
        aria-label="Change piece"
        tabIndex={-1}
        onClose={() => {
          setChangePieceOpen(false)
          changePieceButtonRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            changePieceDialogRef.current?.close()
          }
        }}
      >
        <h2>Change piece</h2>
        <ImportPanel />
        <button
          type="button"
          className="btn-ghost score-change-piece-close"
          onClick={() => changePieceDialogRef.current?.close()}
        >
          Close
        </button>
      </dialog>
    </div>
  )
}
