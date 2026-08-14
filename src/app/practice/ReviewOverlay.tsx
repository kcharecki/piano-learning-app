/**
 * Post-assessment review overlay (roadmap 2.11, REQ-3.3.5): which measures
 * went badly, and a one-click button per suggested loop that sets the
 * transport's loop range and starts playing it (`useAssessment.practiceLoop`,
 * built on `core/practice/review.ts`'s `problemMeasures`/`suggestedLoops`).
 * Purely presentational — the problem list and loop suggestions are computed
 * by the hook, not here.
 *
 * A flawless run must read as a deliberate, positive result, not as this
 * overlay quietly rendering nothing: with no problems, `loops` is empty by
 * construction (`suggestedLoops` returns `[]` when there is nothing to loop),
 * and that is exactly when the "clean run" message below is the only thing on
 * screen — never both an empty list AND no explanation.
 *
 * Measure numbers here are shown 1-based, matching the printed score: the
 * problem list adds 1 to `problem.measureIndex`, and the loop button label
 * adds 1 to `loop.startMeasure`/`endMeasure`. `review.ts`'s own `reason`
 * string is already 1-based prose (core converts at that boundary), so it
 * needs no reformatting here — the problem list and the loop suggestion for
 * the same measure agree on the same number.
 *
 * Roadmap UI-10 (2026-08-12 UI audit): the problem list and loop suggestions
 * used to print inline, unconditionally, as soon as an assessment completed —
 * more always-visible content stacked under "More tools". They now sit behind
 * one explicit trigger button and a real `<dialog>` (the same
 * `showModal`/`close` + manual-focus-restore pattern `TimingFeedback`'s
 * accuracy-info popover already uses), styled `--elev-3` + a fade/rise-in
 * (feature-practice-sections.css) — DESIGN.md's overlay treatment. A clean
 * run has nothing to review, so it keeps printing its "nothing to review"
 * line directly, with no button and no dialog to open.
 */
import type { ProblemMeasure, ProblemReason, SuggestedLoop } from '@core/practice/review.ts'
import { useEffect, useRef, useState } from 'react'

export type ReviewOverlayProps = {
  readonly problems: readonly ProblemMeasure[]
  readonly loops: readonly SuggestedLoop[]
  readonly onPracticeLoop: (loop: SuggestedLoop) => void
}

const REASON_LABEL: Record<ProblemReason, string> = {
  accuracy: 'wrong notes',
  timing: 'uneven timing',
  missed: 'missed notes',
  extra: 'extra notes',
}

function loopKey(loop: SuggestedLoop): string {
  return `${loop.startMeasure}-${loop.endMeasure}`
}

export function ReviewOverlay({ problems, loops, onPracticeLoop }: ReviewOverlayProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  if (problems.length === 0) {
    return (
      <div className="review-overlay-summary">
        <p role="status">Clean run — no problem measures to review.</p>
      </div>
    )
  }

  return (
    <div className="review-overlay-summary">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Review {problems.length} problem measure{problems.length === 1 ? '' : 's'}
      </button>
      <dialog
        ref={dialogRef}
        className="review-overlay-dialog"
        aria-label="Review"
        tabIndex={-1}
        onClose={() => {
          setOpen(false)
          triggerRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            dialogRef.current?.close()
          }
        }}
      >
        <h2>Problem measures</h2>
        <ul aria-label="Problem measures">
          {problems.map((problem) => (
            <li key={problem.measureIndex}>
              Measure {problem.measureIndex + 1}:{' '}
              {problem.reasons.map((reason) => REASON_LABEL[reason]).join(', ')}
            </li>
          ))}
        </ul>
        <ul aria-label="Suggested loops">
          {loops.map((loop) => (
            <li key={loopKey(loop)}>
              <span>{loop.reason}</span>
              <button type="button" onClick={() => onPracticeLoop(loop)}>
                Practice measures {loop.startMeasure + 1}–{loop.endMeasure + 1}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-ghost" onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </dialog>
    </div>
  )
}
