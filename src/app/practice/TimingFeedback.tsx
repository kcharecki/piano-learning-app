/**
 * The honest feedback strip (roadmap 2.23, REQ-3.3.2; UI-09, 2026-08-12 UI
 * audit): accuracy, the correct/wrong/missed/extra counts, and the
 * early/late timing readout — together, under the score rather than
 * scattered above it in the old sticky strip. `PracticeScreen` renders this
 * component only once a run has started (`hasStartedRun`); this component is
 * the sole owner of what happens inside it, including "What this screen
 * doesn't check" — an info popover beside Accuracy (REQ-3.3.2's one-click
 * reachability requirement), local to the stat it qualifies instead of a
 * permanent block of prose that used to sit under the controls.
 *
 * Never a fake 100%: `MatchSummary.accuracy` reads 1 when nothing has been
 * decided yet (`matcher.ts`'s own documented default, sane for a caller that
 * divides by the total) — this reads the raw counts instead and shows an em
 * dash for Accuracy until at least one note has been judged.
 */
import type { MatchSummary } from '@core/practice/matcher.ts'
import { useEffect, useRef, useState } from 'react'
import type { Judgement } from './useNoteFeedback.ts'

export type TimingFeedbackProps = {
  readonly summary: MatchSummary
  readonly lastJudgement: Judgement | undefined
}

const COUNT_STATS: ReadonlyArray<{
  readonly testId: string
  readonly label: string
  readonly pick: (summary: MatchSummary) => number
}> = [
  { testId: 'feedback-correct', label: 'Correct', pick: (s) => s.correct },
  { testId: 'feedback-wrong-pitch', label: 'Wrong', pick: (s) => s.wrongPitch },
  { testId: 'feedback-missed', label: 'Missed', pick: (s) => s.missed },
  { testId: 'feedback-extra', label: 'Extra', pick: (s) => s.extra },
]

/** `+120 ms` / `-45 ms`, always signed, rounded for display only — never in the data. */
function formatSignedMs(deviationMs: number): string {
  const rounded = Math.round(deviationMs)
  const sign = rounded < 0 ? '-' : '+'
  return `${sign}${Math.abs(rounded)} ms`
}

function describeJudgement(judgement: Judgement): string {
  const pitchLabel = judgement.correct ? '' : ` (wrong pitch, played ${judgement.midi})`
  if (judgement.timing === 'on-time') return `on time${pitchLabel}`
  return `${judgement.timing} (${formatSignedMs(judgement.deviationMs)})${pitchLabel}`
}

export function TimingFeedback({ summary, lastJudgement }: TimingFeedbackProps) {
  const totalJudged = summary.correct + summary.wrongPitch + summary.missed + summary.extra
  const accuracyDisplay = totalJudged === 0 ? '—' : `${Math.round(summary.accuracy * 100)}%`
  const lastText = lastJudgement === undefined ? '—' : describeJudgement(lastJudgement)
  const meanText = `avg ${Math.round(summary.meanAbsDeviationMs)} ms`

  const [infoOpen, setInfoOpen] = useState(false)
  const infoButtonRef = useRef<HTMLButtonElement>(null)
  const infoDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = infoDialogRef.current
    if (dialog === null) return
    if (infoOpen && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    } else if (!infoOpen && dialog.open) {
      dialog.close()
    }
  }, [infoOpen])

  return (
    <div
      className="card--sunken stat-group practice-feedback-strip"
      role="status"
      aria-live="polite"
      aria-label="Note feedback"
    >
      <div className="stat">
        <span className="stat-value" data-testid="feedback-accuracy">
          {accuracyDisplay}
        </span>
        <span className="stat-label-row">
          <span className="stat-label">Accuracy</span>
          <button
            type="button"
            className="btn-icon practice-accuracy-info-trigger"
            aria-label="What this screen doesn't check"
            aria-haspopup="dialog"
            ref={infoButtonRef}
            onClick={() => setInfoOpen(true)}
          >
            <span aria-hidden="true">?</span>
          </button>
        </span>
      </div>
      {COUNT_STATS.map(({ testId, label, pick }) => (
        <div className="stat" key={testId}>
          <span className="stat-value" data-testid={testId}>
            {pick(summary)}
          </span>
          <span className="stat-label">{label}</span>
        </div>
      ))}
      {/* REQ-3.3.2's other half: the matcher has always computed early/late
          and a signed deviation for every attributed press. */}
      <div className="stat timing-feedback" role="status" aria-label="Note timing feedback">
        <span className="stat-value" data-testid="timing-mean">
          {meanText}
        </span>
        <span className="stat-label">Timing</span>
        <span className="timing-feedback-last" data-testid="timing-last">
          {lastText}
        </span>
      </div>
      <dialog
        ref={infoDialogRef}
        className="practice-accuracy-info-dialog"
        aria-label="What this screen doesn't check"
        tabIndex={-1}
        onClose={() => {
          setInfoOpen(false)
          infoButtonRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            infoDialogRef.current?.close()
          }
        }}
      >
        <p>
          Accuracy here checks which notes you played and when — not how long you held
          them, and not your hand position, wrist, or posture. Treat it as a supplement
          to practicing with a teacher, not a replacement.
        </p>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => infoDialogRef.current?.close()}
        >
          Close
        </button>
      </dialog>
    </div>
  )
}
