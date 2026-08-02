/**
 * `TrendChart` (roadmap 4.7, REQ-3.10.1): a presentational SVG chart. These
 * tests exist mainly to prove the empty and single-point series never
 * produce `NaN` coordinates — an `NaN` in a `path` `d` (or a `cx`/`cy`)
 * renders nothing and throws nothing, which is exactly the silent-blank
 * failure mode this project keeps shipping.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TrendChart, type TrendChartPoint } from './TrendChart.tsx'

afterEach(cleanup)

function attrsOf(el: Element | null, ...names: string[]): (string | null)[] {
  if (el === null) throw new Error('expected an element')
  return names.map((n) => el.getAttribute(n))
}

describe('TrendChart — empty series', () => {
  it('renders no path and no circles/rects, and shows a "No data" label', () => {
    const { container } = render(
      <TrendChart points={[]} kind="line" ariaLabel="Empty line chart" />,
    )

    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelectorAll('circle')).toHaveLength(0)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
    expect(container.querySelector('text')?.textContent).toBe('No data')
  })

  it('renders no bars for an empty bar-kind series either', () => {
    const { container } = render(
      <TrendChart points={[]} kind="bar" ariaLabel="Empty bar chart" />,
    )

    expect(container.querySelectorAll('rect')).toHaveLength(0)
    expect(container.querySelector('text')?.textContent).toBe('No data')
  })

  it('is reachable by its accessible name', () => {
    const { getByRole } = render(<TrendChart points={[]} kind="line" ariaLabel="A named chart" />)
    expect(getByRole('img', { name: 'A named chart' })).toBeTruthy()
  })
})

describe('TrendChart — single-point series', () => {
  const onePoint: readonly TrendChartPoint[] = [{ label: 'only', value: 42 }]

  it('line kind: draws one circle at a finite, centered position and no path (nothing to connect)', () => {
    const { container } = render(
      <TrendChart points={onePoint} kind="line" ariaLabel="Single-point line" width={200} height={100} />,
    )

    expect(container.querySelector('path')).toBeNull()
    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(1)
    const [cx, cy] = attrsOf(circles[0] ?? null, 'cx', 'cy')
    expect(cx).not.toBeNull()
    expect(cy).not.toBeNull()
    expect(Number.isNaN(Number(cx))).toBe(false)
    expect(Number.isNaN(Number(cy))).toBe(false)
    // Only one point: no x-span to spread across, so it sits in the horizontal center.
    expect(Number(cx)).toBeCloseTo(100, 5)
  })

  it('bar kind: draws one bar at a finite position with zero-safe height', () => {
    const { container } = render(
      <TrendChart points={onePoint} kind="bar" ariaLabel="Single-point bar" width={200} height={100} />,
    )

    const rects = container.querySelectorAll('rect')
    expect(rects).toHaveLength(1)
    const [x, y, width, height] = attrsOf(rects[0] ?? null, 'x', 'y', 'width', 'height')
    for (const attr of [x, y, width, height]) {
      expect(attr).not.toBeNull()
      expect(Number.isNaN(Number(attr))).toBe(false)
    }
  })

  it('a flat series (every value identical) never divides by a zero range into NaN', () => {
    const flat: readonly TrendChartPoint[] = [
      { label: 'a', value: 5 },
      { label: 'b', value: 5 },
      { label: 'c', value: 5 },
    ]
    const { container } = render(<TrendChart points={flat} kind="line" ariaLabel="Flat series" />)

    const path = container.querySelector('path')
    expect(path).not.toBeNull()
    expect(path?.getAttribute('d')).not.toContain('NaN')
    for (const circle of container.querySelectorAll('circle')) {
      expect(circle.getAttribute('cx')).not.toContain('NaN')
      expect(circle.getAttribute('cy')).not.toContain('NaN')
    }
  })
})

describe('TrendChart — multi-point series', () => {
  const points: readonly TrendChartPoint[] = [
    { label: 'mon', value: 0 },
    { label: 'tue', value: 10 },
    { label: 'wed', value: 30 },
  ]

  it('line kind: one circle per point and a path with no NaN, in point order', () => {
    const { container } = render(
      <TrendChart points={points} kind="line" ariaLabel="Weekly trend" width={300} height={90} />,
    )

    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(3)

    const path = container.querySelector('path')
    expect(path).not.toBeNull()
    const d = path?.getAttribute('d') ?? ''
    expect(d).not.toContain('NaN')
    expect(d.startsWith('M')).toBe(true)
    // Two line-to commands connect the remaining two points.
    expect(d.match(/L/g)).toHaveLength(2)

    // The highest value (30, at index 2) sits highest on screen — smallest y.
    const cys = [...circles].map((c) => Number(c.getAttribute('cy')))
    expect(cys[2]).toBeLessThan(cys[0] ?? Infinity)
  })

  it('bar kind: one rect per point, tallest bar for the largest value, none NaN', () => {
    const { container } = render(
      <TrendChart points={points} kind="bar" ariaLabel="Weekly bars" width={300} height={90} />,
    )

    const rects = container.querySelectorAll('rect')
    expect(rects).toHaveLength(3)
    const heights = [...rects].map((r) => Number(r.getAttribute('height')))
    expect(heights.every((h) => !Number.isNaN(h))).toBe(true)
    // value 0 (mon) draws a zero-height bar; value 30 (wed) is the tallest.
    expect(heights[0]).toBe(0)
    expect(heights[2]).toBeGreaterThan(heights[1] ?? -1)
  })

  it('keeps every bar fully inside the viewBox, including the first and last', () => {
    const eight: readonly TrendChartPoint[] = Array.from({ length: 8 }, (_, i) => ({
      label: `d${i}`,
      value: i,
    }))
    const { container } = render(
      <TrendChart points={eight} kind="bar" ariaLabel="Eight-bar series" width={280} height={80} />,
    )
    const rects = container.querySelectorAll('rect')
    expect(rects).toHaveLength(8)
    for (const rect of rects) {
      const x = Number(rect.getAttribute('x'))
      const w = Number(rect.getAttribute('width'))
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x + w).toBeLessThanOrEqual(280)
    }
  })

  it('embeds each point label and value in a <title> tooltip', () => {
    const { container } = render(
      <TrendChart points={points} kind="bar" ariaLabel="Weekly bars" valueSuffix=" min" />,
    )
    const titles = [...container.querySelectorAll('rect title')].map((t) => t.textContent)
    expect(titles).toEqual(['mon: 0 min', 'tue: 10 min', 'wed: 30 min'])
  })
})
