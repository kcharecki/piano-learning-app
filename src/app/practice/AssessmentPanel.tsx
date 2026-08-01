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
 */
import { passesThreshold, type AssessmentResult } from '@core/practice/assessment.ts'
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
          <dl>
            <dt>Accuracy</dt>
            <dd data-testid="assessment-accuracy">{percent(result.accuracy)}</dd>
            <dt>Timing consistency</dt>
            <dd data-testid="assessment-timing">{percent(result.timingConsistency)}</dd>
          </dl>
          <p data-testid="assessment-verdict">
            {passesThreshold(result) ? 'Passed' : 'Needs more practice'}
          </p>
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
        </div>
      )}
    </div>
  )
}
