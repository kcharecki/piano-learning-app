/**
 * Assessment run control and result panel (roadmap 2.11, REQ-3.3.4). A thin,
 * controlled component: all state and computation lives in `useAssessment`
 * (which reduces the run with `core/practice/assessment.ts`'s `assess` and
 * `passesThreshold`) — this only renders it and forwards the start action.
 *
 * The per-measure table numbers rows 1-based (`measureIndex + 1`), matching
 * how `ReviewOverlay` numbers the same measures in its problem list and loop
 * suggestions — the two panels must agree on what "measure 3" means to a
 * learner reading it against the printed score.
 *
 * Roadmap UI-10 (2026-08-12 UI audit): the headline numbers (accuracy, timing
 * consistency, pass/fail) stay inline — a learner glancing at the screen
 * after a run needs those without a click. The per-measure table is the
 * detail underneath them, and moves behind an explicit "View measure
 * breakdown" trigger into a real `<dialog>` — the same `showModal`/`close` +
 * manual-focus-restore pattern `ReviewOverlay`'s dialog and `TimingFeedback`'s
 * accuracy-info popover already use, styled `--elev-3` + a fade/rise-in
 * (feature-practice-sections.css).
 */
import { passesThreshold, type AssessmentResult } from '@core/practice/assessment.ts'
import { useEffect, useRef, useState } from 'react'
import type { AssessmentRunPhase } from './useAssessment.ts'

export type AssessmentPanelProps = {
  readonly phase: AssessmentRunPhase
  readonly result: AssessmentResult | undefined
  /** Usually "a score is loaded"; the button is disabled without it. */
  readonly canStart: boolean
  readonly onStart: () => void
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function AssessmentPanel({ phase, result, canStart, onStart }: AssessmentPanelProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (breakdownOpen && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    } else if (!breakdownOpen && dialog.open) {
      dialog.close()
    }
  }, [breakdownOpen])

  // A fresh run replaces the result the dialog would be showing — never
  // leave a stale breakdown open behind a "Run assessment again" click.
  useEffect(() => {
    if (phase !== 'complete') setBreakdownOpen(false)
  }, [phase])

  return (
    <div className="assessment-panel" role="group" aria-label="Assessment">
      <button type="button" onClick={onStart} disabled={!canStart || phase === 'running'}>
        {phase === 'complete' ? 'Run assessment again' : 'Start assessment'}
      </button>
      {phase === 'running' && (
        <p role="status">Assessment running — play the piece through at tempo.</p>
      )}
      {phase === 'complete' && result !== undefined && (
        <div className="assessment-result">
          <div className="stat-group">
            <div className="stat">
              <span className="stat-value" data-testid="assessment-accuracy">
                {percent(result.accuracy)}
              </span>
              <span className="stat-label">Accuracy</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="assessment-timing">
                {percent(result.timingConsistency)}
              </span>
              <span className="stat-label">Timing consistency</span>
            </div>
          </div>
          <p data-testid="assessment-verdict">
            {passesThreshold(result) ? 'Passed' : 'Needs more practice'}
          </p>
          <button
            type="button"
            className="btn-ghost"
            ref={triggerRef}
            aria-haspopup="dialog"
            onClick={() => setBreakdownOpen(true)}
          >
            View measure breakdown
          </button>
          <dialog
            ref={dialogRef}
            className="assessment-breakdown-dialog"
            aria-label="Measure breakdown"
            tabIndex={-1}
            onClose={() => {
              setBreakdownOpen(false)
              triggerRef.current?.focus()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                dialogRef.current?.close()
              }
            }}
          >
            <table>
              <caption>Per-measure breakdown</caption>
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Accuracy</th>
                  <th scope="col">Correct</th>
                  <th scope="col">Wrong pitch</th>
                  <th scope="col">Missed</th>
                  <th scope="col">Extra</th>
                </tr>
              </thead>
              <tbody>
                {result.measures.map((measure) => (
                  <tr key={measure.measureIndex}>
                    <th scope="row">{measure.measureIndex + 1}</th>
                    <td>{percent(measure.accuracy)}</td>
                    <td>{measure.correct}</td>
                    <td>{measure.wrongPitch}</td>
                    <td>{measure.missed}</td>
                    <td>{measure.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn-ghost" onClick={() => dialogRef.current?.close()}>
              Close
            </button>
          </dialog>
        </div>
      )}
    </div>
  )
}
