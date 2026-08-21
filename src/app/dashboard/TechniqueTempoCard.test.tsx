/**
 * Roadmap T.14 — the "Technique tempo" card must not flatten two drills with
 * two different target tempos onto one unlabelled line.
 *
 * The reproduction the roadmap recorded is the fixture here: one clean solid
 * triad attempt (target 72) and one clean broken triad attempt (target 60).
 * The old card drew a single line going 72 → 60, so two correct runs read as
 * getting slower, and the only thing on screen naming a drill was a per-point
 * SVG tooltip.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { TechniqueTempoCard, MAX_SERIES, type TechniqueTempoCardProps } from './TechniqueTempoCard.tsx'
import type { TechniqueTempoSeries } from './useDashboard.ts'

afterEach(cleanup)

const SOLID = 'triad-sequence-c-major-solid-hands-right'
const BROKEN = 'triad-sequence-c-major-broken-hands-right'

function series(overrides: Partial<TechniqueTempoSeries>): TechniqueTempoSeries {
  return {
    drillId: SOLID,
    title: 'C major triad sequence, solid, right hand',
    targetBpm: 72,
    points: [{ at: 1000, bpm: 72 }],
    bestBpm: 72,
    ...overrides,
  }
}

/** The roadmap's own two-drill state. */
const TWO_DRILLS: readonly TechniqueTempoSeries[] = [
  series({
    drillId: BROKEN,
    title: 'C major triad sequence, broken, right hand',
    targetBpm: 60,
    points: [{ at: 2000, bpm: 60 }],
    bestBpm: 60,
  }),
  series({}),
]

function renderCard(props: Partial<TechniqueTempoCardProps> = {}) {
  return render(<TechniqueTempoCard series={TWO_DRILLS} {...props} />)
}

describe('TechniqueTempoCard', () => {
  it('draws one chart per drill, each named, instead of one line for both', () => {
    // Both drills with a trend to draw, so the count below is about how the
    // charts are split and not about the single-point rule.
    renderCard({
      series: TWO_DRILLS.map((s) => ({
        ...s,
        points: [
          { at: s.points[0]?.at ?? 0, bpm: s.bestBpm - 12 },
          { at: (s.points[0]?.at ?? 0) + 100, bpm: s.bestBpm },
        ],
      })),
    })
    // Two charts, and each says which drill it is in its accessible name —
    // where the old card had one chart called "Technique clean tempo over
    // time" holding both drills' points.
    expect(
      screen.getByRole('img', { name: 'C major triad sequence, solid, right hand — clean tempo over time' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'C major triad sequence, broken, right hand — clean tempo over time' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('img').length).toBe(2)
  })

  it('says the number rather than drawing a one-point line', () => {
    renderCard()
    // Both fixture drills have exactly one clean run. A lone dot in an empty
    // box reads as a broken chart, and the best line says it better.
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.getByText('Best 72 of 72 bpm · 1 clean run')).toBeTruthy()
  })

  it('reads each drill’s best against that drill’s own target, not against the other drill', () => {
    renderCard()
    // 60 is not a decline from 72 — it is this drill's target, met.
    expect(screen.getByText('Best 72 of 72 bpm · 1 clean run')).toBeTruthy()
    expect(screen.getByText('Best 60 of 60 bpm · 1 clean run')).toBeTruthy()
  })

  it('names each drill in visible text, not only in a tooltip', () => {
    renderCard()
    expect(
      screen.getByRole('heading', { name: 'C major triad sequence, broken, right hand' }),
    ).toBeTruthy()
  })

  it('counts clean runs per drill', () => {
    renderCard({
      series: [
        series({
          points: [
            { at: 1000, bpm: 60 },
            { at: 2000, bpm: 66 },
            { at: 3000, bpm: 72 },
          ],
          bestBpm: 72,
        }),
      ],
    })
    expect(screen.getByText('Best 72 of 72 bpm · 3 clean runs')).toBeTruthy()
  })

  it('caps how many drills it draws and says how many it left out', () => {
    const many = Array.from({ length: MAX_SERIES + 2 }, (_, i) =>
      series({
        drillId: `drill-${String(i)}`,
        title: `Drill ${String(i)}`,
        points: [
          { at: 1000, bpm: 60 },
          { at: 2000, bpm: 72 },
        ],
      }),
    )
    renderCard({ series: many })
    expect(screen.getAllByRole('img').length).toBe(MAX_SERIES)
    expect(screen.getByTestId('dashboard-technique-more').textContent).toBe(
      'And 2 other drills practised less recently.',
    )
  })

  it('does not count anything when nothing was left out', () => {
    renderCard()
    expect(screen.queryByTestId('dashboard-technique-more')).toBeNull()
  })

  it('teaches rather than showing an empty chart when no run has been clean', () => {
    renderCard({ series: [] })
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.getByTestId('dashboard-technique-empty').textContent).toContain(
      'No clean technique run yet',
    )
  })

  it('keeps its region name, so the dashboard layout and its tests still find it', () => {
    renderCard()
    expect(screen.getByRole('region', { name: 'Technique tempo trends' })).toBeTruthy()
  })
})
