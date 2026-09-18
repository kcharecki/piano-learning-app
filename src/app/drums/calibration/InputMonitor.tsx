/**
 * `InputMonitor` (roadmap DR-08): every raw MIDI event `useDrumMidiInput`
 * saw, newest first — the "why isn't my pad showing up" panel for
 * `CalibrationScreen`. Purely a renderer over `MonitorEntry[]`; the
 * classification and line text are `@app/drums/input/monitor.ts`'s job.
 */
import { monitorGapText, monitorLine, type MonitorEntry } from '@app/drums/input/monitor.ts'

export type InputMonitorProps = {
  readonly entries: readonly MonitorEntry[]
}

export function InputMonitor({ entries }: InputMonitorProps) {
  return (
    <section aria-labelledby="drums-input-monitor-heading" className="input-monitor">
      <h2 id="drums-input-monitor-heading">Input monitor</h2>
      <p className="input-monitor-copy">
        Every event your kit sends, newest first — if a pad is not showing up, this is where to
        look.
      </p>
      {entries.length === 0 ? (
        <p role="status" aria-label="Input monitor status">
          No events yet — hit a pad on your kit.
        </p>
      ) : (
        <ol aria-label="Input events" className="input-monitor-list">
          {entries.map((entry, i) => (
            <li key={entry.seq}>
              <span className="input-monitor-gap">{monitorGapText(entry, entries[i + 1])}</span>
              <span className="input-monitor-line">{monitorLine(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
