/**
 * AnalysisPanel (roadmap 3.2a, REQ-3.5.5) — renders `analyseScore` under the
 * bundled sample and asserts the actual roman numerals it names, in order,
 * plus the cadence at each phrase end. A test that only asserts the region
 * exists would be worthless here: the region rendering with nothing in it is
 * exactly the defect this suite exists to catch.
 */
import sampleMusicXml from '@content/scores/twinkle-twinkle-little-star.musicxml?raw'
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { makeScore } from '@core/notation/score.ts'
import { unwrap } from '@core/shared/result.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel.tsx'

afterEach(cleanup)

describe('AnalysisPanel', () => {
  it('is a labelled region', () => {
    const score = unwrap(parseMusicXml(sampleMusicXml))
    render(<AnalysisPanel score={score} />)
    expect(screen.getByRole('region', { name: 'Harmonic analysis' })).toBeInTheDocument()
  })

  it('names the real I V IV I skeleton of Twinkle Twinkle, in order, one label per measure', () => {
    const score = unwrap(parseMusicXml(sampleMusicXml))
    render(<AnalysisPanel score={score} />)

    // The left hand holds one block chord per measure under a moving melody:
    // I V IV I, repeated across mm 1-4, 5-8 and 9-12 (see analysis.test.ts,
    // which pins this exact sequence against `analyseScore` directly). Assert
    // the exact chords-span text (not substring containment — 'IV' contains
    // 'I' and 'V', so a panel that mislabels everything as 'IV' would still
    // satisfy a `toContain` check against every expected numeral).
    const expected = ['I', 'V', 'IV', 'I', 'I', 'V', 'IV', 'I', 'I', 'V', 'IV', 'I']
    const actual = expected.map((_, index) =>
      screen.getByTestId(`analysis-measure-${index}`).querySelector('.analysis-chords')?.textContent,
    )
    expect(actual).toEqual(expected)
  })

  it('collapses a measure split into several melody-driven slices into one numeral, not a repeat per slice', () => {
    const score = unwrap(parseMusicXml(sampleMusicXml))
    render(<AnalysisPanel score={score} />)

    // Measure index 2 (m.3): the left hand holds IV as a whole note while the
    // melody re-attacks several times — the panel must still print "IV" once,
    // not "IV IV" or "IV IV IV".
    const measure3 = screen.getByTestId('analysis-measure-2')
    const ivCount = measure3.textContent?.match(/IV/g)?.length ?? 0
    expect(ivCount).toBe(1)
  })

  it('names a plagal cadence at the end of each of the three phrases', () => {
    const score = unwrap(parseMusicXml(sampleMusicXml))
    render(<AnalysisPanel score={score} />)

    // Phrase ends land on the last measure of each 4-measure phrase: mm 4, 8, 12
    // (0-indexed 3, 7, 11) — see analysis.test.ts for the same three cadences
    // pinned directly against `analyseScore`.
    for (const measureIndex of [3, 7, 11]) {
      const measure = screen.getByTestId(`analysis-measure-${measureIndex}`)
      expect(measure.textContent).toMatch(/plagal cadence/i)
    }

    // No cadence is named at a mid-phrase measure.
    const midPhrase = screen.getByTestId('analysis-measure-1')
    expect(midPhrase.textContent).not.toMatch(/cadence/i)
  })

  it('renders an explicit dash, never a blank gap, for a slice the analyser could not name', () => {
    // A tight chromatic cluster: no root/quality combination is recognisable in
    // any key, so `analyseScore` reports `numeral: null` for its one slice
    // (mirrors the "unrecognisable" fixture in analysis.test.ts).
    const score = makeScore({
      id: 'unrecognisable-probe',
      measures: [{ keyFifths: 0 }],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 61, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 62, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 63, startTick: 0, durationTicks: 1920, hand: 'right' },
      ],
    })
    render(<AnalysisPanel score={score} />)

    const measure = screen.getByTestId('analysis-measure-0')
    expect(measure.textContent).toContain('—')
  })

  it('names an inverted chord with its figured bass, and an imperfect authentic cadence', () => {
    // m.1: B2-D3-G3 (a first-inversion G major triad = V6 in C); m.2: C3-E3-G3
    // (I). `analyseScore` resolves this progression as V6 -> I with an
    // imperfect-authentic cadence at the final chord (see analysis.test.ts for
    // the same reading pinned directly against `analyseScore`).
    const score = makeScore({
      id: 'inverted-cadence-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        { midi: 47, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 50, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 55, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 48, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 52, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 55, startTick: 1920, durationTicks: 1920, hand: 'left' },
      ],
    })
    render(<AnalysisPanel score={score} />)

    expect(
      screen.getByTestId('analysis-measure-0').querySelector('.analysis-chords')?.textContent,
    ).toBe('V6')
    expect(
      screen.getByTestId('analysis-measure-1').querySelector('.analysis-cadence')?.textContent,
    ).toBe('Imperfect authentic cadence')
  })

  it('names the key from the score, not a hardcoded default', () => {
    const score = unwrap(parseMusicXml(sampleMusicXml))
    render(<AnalysisPanel score={score} />)
    expect(screen.getByText('Key: C major')).toBeInTheDocument()
  })
})
