/**
 * Printable practice sheet (roadmap 5.47, REQ-3.10.4) — a teacher/parent
 * output. `ExportPanel`'s JSON/CSV above this is a backup format nobody but
 * the app itself can read back; this is the opposite: nothing a human can
 * restore, everything a human can read.
 *
 * Closed by default (an extra always-open panel would cost this screen one
 * of its ~6-control budget for no benefit most sessions) — "Show practice
 * sheet" reveals a preview styled like a physical page (the theme-constant
 * `--paper` tokens, so it reads the same in dark or light mode), then
 * "Print" calls the real `window.print()`. `feature-print-sheet.css`'s
 * `@media print` block hides everything else on the page — nav, every other
 * dashboard section, the `no-print` actions row here — so only `.practice-sheet`
 * itself ends up on the printed page, sized to fit one.
 *
 * Empty state (roadmap 5.47's own stated bar — "a learner who prints a sheet
 * after one day, or after zero days, must get something honest rather than a
 * blank page or a fabricated week"): `usePracticeSheet`'s `hasActivity` is
 * checked BEFORE any table renders, so a learner who prints on day one gets
 * an honest "no practice recorded yet" sheet, never an empty table implying
 * nothing was practiced when the real reason is that the log itself is new.
 *
 * The accuracy caveat: this app assesses note pitch and timing from MIDI
 * input only — it has no camera, no audio analysis of tone, and cannot see
 * posture at all. A printed accuracy percentage handed to a parent is the
 * highest-authority number this app produces, so `ACCURACY_CAVEAT` is always
 * printed alongside it, not left implicit.
 */
import { useId, useState } from 'react'
import { ACTIVITY_KIND_LABELS } from './activityKindLabels.ts'
import { usePracticeSheet, type UsePracticeSheetOptions } from './usePracticeSheet.ts'

export type PracticeSheetProps = UsePracticeSheetOptions

const DATE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const DATE_FMT_WITH_YEAR: Intl.DateTimeFormatOptions = { ...DATE_FMT, year: 'numeric' }

function formatDate(epochMs: number, withYear = false): string {
  return new Date(epochMs).toLocaleDateString(undefined, withYear ? DATE_FMT_WITH_YEAR : DATE_FMT)
}

/** `rangeEnd` is exclusive (`[rangeStart, rangeEnd)`, matching `@core/progress/log.ts`), so the
 *  human-readable end date is one millisecond back, inside the window it actually describes. */
function formatRange(rangeStart: number, rangeEnd: number): string {
  return `${formatDate(rangeStart)} – ${formatDate(rangeEnd - 1, true)}`
}

const ACCURACY_CAVEAT =
  'Accuracy is the share of expected notes played at the right pitch and time, measured from MIDI ' +
  'input only. It does not measure tone, dynamics, phrasing, technique, or posture.'

export function PracticeSheet(props: PracticeSheetProps) {
  const [open, setOpen] = useState(false)
  const data = usePracticeSheet(props)
  const headingId = useId()

  return (
    <section aria-label="Practice sheet" role="region" className="practice-sheet-panel card">
      <h3>Practice sheet</h3>
      <p>
        A one-page summary of the last {data.totalDays} days &mdash; categories, minutes, what was
        practiced, and what was assessed &mdash; ready to print for a teacher or parent.
      </p>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide practice sheet' : 'Show practice sheet'}
      </button>

      {open && (
        <div className="practice-sheet" aria-labelledby={headingId}>
          <header className="practice-sheet-header">
            <h4 id={headingId}>Practice sheet</h4>
            <p>{formatRange(data.rangeStart, data.rangeEnd)}</p>
          </header>

          {!data.hasActivity ? (
            <p role="status" data-testid="practice-sheet-empty">
              No practice recorded in the last {data.totalDays} days yet &mdash; nothing to report.
            </p>
          ) : (
            <>
              <p data-testid="practice-sheet-summary">
                Practiced {data.daysPracticed} of {data.totalDays} days, {Math.round(data.totalMinutes)}{' '}
                minutes total.
              </p>

              <h5>By category</h5>
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Minutes</th>
                    <th className="num">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c) => (
                    <tr key={c.kind} data-testid={`practice-sheet-category-${c.kind}`}>
                      <td>{ACTIVITY_KIND_LABELS[c.kind]}</td>
                      <td className="num">{Math.round(c.minutes)}</td>
                      <td className="num">{c.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h5>What was practiced</h5>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th className="num">Sessions</th>
                    <th className="num">Minutes</th>
                    <th>Last practiced</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item, i) => (
                    <tr key={`${item.kind}-${item.itemName}-${i}`} data-testid={`practice-sheet-item-${i}`}>
                      <td>{item.itemName}</td>
                      <td>{ACTIVITY_KIND_LABELS[item.kind]}</td>
                      <td className="num">{item.sessions}</td>
                      <td className="num">{Math.round(item.minutes)}</td>
                      <td>{formatDate(item.lastPracticedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h5>What was assessed</h5>
              {data.assessments.length === 0 ? (
                <p role="status" data-testid="practice-sheet-assessments-empty">
                  No assessments recorded this period.
                </p>
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>Piece</th>
                        <th className="num">Accuracy</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.assessments.map((a, i) => (
                        <tr key={`${a.scoreTitle}-${i}`} data-testid={`practice-sheet-assessment-${i}`}>
                          <td>{a.scoreTitle}</td>
                          <td className="num">{Math.round(a.accuracy * 100)}%</td>
                          <td>{formatDate(a.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="practice-sheet-caveat">{ACCURACY_CAVEAT}</p>
                </>
              )}
            </>
          )}

          <div className="practice-sheet-actions no-print">
            <button type="button" className="btn-primary" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
