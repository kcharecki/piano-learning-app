/**
 * A readable stand-in for engraved rhythm notation (roadmap 2.13), in the
 * same spirit as `@app/sightreading/NoteListPreview.tsx`: no engraving
 * exists for a bare `RhythmPattern`, so this prints its real onsets — grouped
 * by bar, each with a readable duration name and a rest marker — rather than
 * fabricating one or rendering nothing. Presentational only: no state, no
 * ports, no music logic beyond formatting.
 */
import { durationLabel } from '@app/sightreading/noteDisplay.ts'
import { measureDurationTicks } from '@core/notation/score.ts'
import type { RhythmOnset, RhythmPattern } from '@core/generator/rhythm.ts'

export type PatternPreviewProps = {
  readonly pattern: RhythmPattern
}

type Bar = {
  readonly barIndex: number
  readonly onsets: readonly RhythmOnset[]
}

function groupByBar(pattern: RhythmPattern): readonly Bar[] {
  const barTicks = measureDurationTicks(pattern.timeSignature)
  return Array.from({ length: pattern.bars }, (_, barIndex) => ({
    barIndex,
    onsets: pattern.onsets.filter((onset) => Math.floor(onset.tick / barTicks) === barIndex),
  }))
}

function onsetLabel(onset: RhythmOnset): string {
  const label = durationLabel(onset.durationTicks)
  return onset.isRest ? `${label} rest` : label
}

export function PatternPreview({ pattern }: PatternPreviewProps) {
  const bars = groupByBar(pattern)
  return (
    <div className="pattern-preview" aria-label="Rhythm pattern">
      <ol className="pattern-preview-bars">
        {bars.map((bar) => (
          <li key={bar.barIndex} data-testid={`pattern-bar-${bar.barIndex}`}>
            <span className="pattern-preview-bar-number">Bar {bar.barIndex + 1}</span>
            <span className="pattern-preview-onsets">
              {bar.onsets.map((onset, onsetIndex) => (
                <span key={onset.tick}>
                  {onsetIndex > 0 ? ', ' : ''}
                  <span
                    className="pattern-preview-onset"
                    data-testid="pattern-onset"
                    data-rest={onset.isRest ? 'true' : 'false'}
                  >
                    {onsetLabel(onset)}
                  </span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
