/**
 * Roman-numeral analysis panel (roadmap 3.2a, REQ-3.5.5) — a read-only reading
 * aid rendered under the score. `analyseScore` (`@core/theory/analysis.ts`)
 * does all the music-theory work; this component only lays its result out per
 * measure and names the cadences at phrase ends.
 *
 * `analyseScore` is memoised on the `score` prop — re-running the analyser on
 * every render of a playing transport (which re-renders every animation
 * frame) would be a real performance defect, not just wasted work.
 *
 * A slice the analyser could not name (`numeral: null`) always renders as an
 * explicit em dash, never as a guess and never as a blank gap — the same rule
 * `analyseScore` itself documents for its own `numeral` field. Adjacent slices
 * that read the same way (a held chord split into several slices by a moving
 * melody, or several unnamed slices in a row) collapse into one label — this
 * is a reading aid, not a data dump of every internal slice boundary.
 */
import { useMemo } from 'react'
import { analyseScore, type Analysis, type AnalysedChord } from '@core/theory/analysis.ts'
import type { CadenceType } from '@core/theory/harmony.ts'
import { keyName } from '@core/theory/keys.ts'
import { notesInMeasure, type Score } from '@core/notation/score.ts'

export type AnalysisPanelProps = { readonly score: Score }

/** A slice whose sounding pitches spell nothing analysable in the key. */
const UNNAMED = '—'
/** A measure with no sounding pitches at all — a different fact from `UNNAMED`:
 *  "nothing sounds here" rather than "the analyser could not name this". */
const TACET = '(rest)'

const CADENCE_LABEL: Readonly<Record<Exclude<CadenceType, 'none'>, string>> = {
  'perfect-authentic': 'Perfect authentic cadence',
  'imperfect-authentic': 'Imperfect authentic cadence',
  half: 'Half cadence',
  plagal: 'Plagal cadence',
  deceptive: 'Deceptive cadence',
}

type MeasureRow = {
  readonly index: number
  readonly number: string
  readonly labels: readonly string[]
  readonly cadences: readonly string[]
}

/** The cadence types named at each measure, keyed by the measure of the FINAL chord
 *  of the cadential pair — that is where a phrase end is heard and read. A measure
 *  can carry more than one cadence (two phrase ends resolving in the same bar), so
 *  every entry is kept, not just the last one written. */
function cadencesByMeasure(
  analysis: Analysis,
): ReadonlyMap<number, readonly Exclude<CadenceType, 'none'>[]> {
  const byMeasure = new Map<number, Exclude<CadenceType, 'none'>[]>()
  for (const cadence of analysis.cadences) {
    // `findCadences` never records a 'none' cadence — only a real phrase end
    // is pushed onto `analysis.cadences` in the first place.
    if (cadence.type === 'none') continue
    const finalChord = analysis.chords[cadence.atChordIndex]
    if (finalChord === undefined) continue
    const existing = byMeasure.get(finalChord.measureIndex)
    if (existing === undefined) byMeasure.set(finalChord.measureIndex, [cadence.type])
    else existing.push(cadence.type)
  }
  return byMeasure
}

/** Every chord reading, bucketed by measure in a single pass — avoids rescanning
 *  the whole `analysis.chords` array once per measure. */
function chordsByMeasure(analysis: Analysis): ReadonlyMap<number, readonly AnalysedChord[]> {
  const byMeasure = new Map<number, AnalysedChord[]>()
  for (const chord of analysis.chords) {
    const existing = byMeasure.get(chord.measureIndex)
    if (existing === undefined) byMeasure.set(chord.measureIndex, [chord])
    else existing.push(chord)
  }
  return byMeasure
}

/** Every chord reading in this measure, as its printed roman numeral (figured
 *  bass included in `numeral.text` already) or `UNNAMED` — collapsing runs of
 *  consecutive slices that read identically, so a held chord split across
 *  several melody-driven slices prints once, not once per slice. */
function labelsForMeasure(chords: readonly AnalysedChord[] | undefined): readonly string[] {
  const labels: string[] = []
  for (const chord of chords ?? []) {
    const label = chord.numeral === null ? UNNAMED : chord.numeral.text
    if (labels[labels.length - 1] !== label) labels.push(label)
  }
  return labels
}

function buildRows(score: Score, analysis: Analysis): readonly MeasureRow[] {
  const cadences = cadencesByMeasure(analysis)
  const chords = chordsByMeasure(analysis)
  return score.measures.map((measure) => {
    const measureChords = chords.get(measure.index)
    const labels = labelsForMeasure(measureChords)
    return {
      index: measure.index,
      number: measure.number,
      labels: labels.length > 0 ? labels : notesInMeasure(score, measure.index).length === 0 ? [TACET] : [UNNAMED],
      cadences: (cadences.get(measure.index) ?? []).map((type) => CADENCE_LABEL[type]),
    }
  })
}

/**
 * The same per-measure numeral text this panel prints in its `.numerals`
 * span, keyed by 1-based measure number — the exact key `ScoreViewer`'s
 * optional `measureLabels` prop expects (roadmap 3.18a) so a caller can put
 * the identical reading on the engraving AND in this side list, from one
 * shared computation, rather than two components independently deciding what
 * a measure "reads as". `UNNAMED`/`TACET` are included: the engraving should
 * show the same explicit "nothing recognisable here"/"(rest)" signal this
 * panel already commits to, never a blank gap that reads as "not analysed
 * yet" (see the module comment above). Not wired into `ScoreScreen.tsx` by
 * this change — that file is outside this module's owned files; a caller
 * wanting the engraving-side labels should use the `useMeasureLabels` hook
 * below rather than calling this directly with an inline `analyseScore(score)`
 * — see that hook's doc comment for why.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared computation, not a component; deliberately reused by ScoreViewer callers
export function buildMeasureLabels(score: Score, analysis: Analysis): ReadonlyMap<number, string> {
  const chords = chordsByMeasure(analysis)
  const labels = new Map<number, string>()
  for (const measure of score.measures) {
    const measureChords = labelsForMeasure(chords.get(measure.index))
    const text =
      measureChords.length > 0
        ? measureChords.join(' ')
        : notesInMeasure(score, measure.index).length === 0
          ? TACET
          : UNNAMED
    labels.set(measure.index + 1, text)
  }
  return labels
}

/**
 * `buildMeasureLabels(score, analyseScore(score))`, memoised on `score` alone
 * (roadmap-review finding 3). Its intended host is `PracticeScreen`'s playing
 * transport, which re-renders every animation frame — inlining the composed
 * call there would run the analyser AND rebuild the label map on every frame,
 * which then fires `ScoreViewer`'s `measureLabels` effect every frame and
 * tears down/rebuilds every `<text>` node in the engraving each time. This
 * hook is the unmissable way to get the labels instead: call it once with the
 * current `score` and pass its result straight through as `measureLabels`.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared hook, not a component; deliberately reused by ScoreViewer callers
export function useMeasureLabels(score: Score): ReadonlyMap<number, string> {
  return useMemo(() => buildMeasureLabels(score, analyseScore(score)), [score])
}

export function AnalysisPanel({ score }: AnalysisPanelProps) {
  const analysis = useMemo(() => analyseScore(score), [score])
  const rows = useMemo(() => buildRows(score, analysis), [score, analysis])

  return (
    <section role="region" aria-label="Harmonic analysis" className="analysis-panel">
      <h2>Harmonic analysis</h2>
      <p className="analysis-key">Key: {keyName(analysis.key)}</p>
      <ol className="analysis-measures">
        {rows.map((row) => (
          <li key={row.index} data-testid={`analysis-measure-${row.index}`}>
            <span className="measure-no">m.{row.number}</span>
            <span className="numerals">{row.labels.join(' ')}</span>
            {row.cadences.map((cadence, i) => (
              <span key={i} className="cadence">
                {cadence}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </section>
  )
}
