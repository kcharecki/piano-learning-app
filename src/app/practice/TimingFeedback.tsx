/**
 * Early/late timing readout (roadmap 2.23, REQ-3.3.2): the matcher already
 * classifies every attributed press as `early` / `on-time` / `late` with a
 * signed millisecond deviation, and until now nothing displayed either one.
 * Purely presentational — `useNoteFeedback` owns the judgement, this only
 * renders it.
 */
import type { Judgement } from './useNoteFeedback.ts'
import { useMemo } from 'react'

export type TimingFeedbackProps = {
  readonly lastJudgement: Judgement | undefined
  /** `summary.meanAbsDeviationMs`, unrounded — rounded here for display only. */
  readonly meanAbsDeviationMs: number
}

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

export function TimingFeedback({ lastJudgement, meanAbsDeviationMs }: TimingFeedbackProps) {
  // A stable layout keeps the region from reflowing neighbours as the text's
  // length changes between renders ("on time" vs "late (+120 ms)").
  const lastText = useMemo(
    () => (lastJudgement === undefined ? '—' : describeJudgement(lastJudgement)),
    [lastJudgement],
  )
  const meanText = useMemo(
    () => `avg ${Math.round(meanAbsDeviationMs)} ms`,
    [meanAbsDeviationMs],
  )

  return (
    <div
      role="status"
      aria-label="Note timing feedback"
      style={{
        width: '24ch',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <span data-testid="timing-last">{lastText}</span>
      <span data-testid="timing-mean">{meanText}</span>
    </div>
  )
}
