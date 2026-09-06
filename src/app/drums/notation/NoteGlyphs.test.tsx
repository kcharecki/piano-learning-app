/**
 * Thin render tests for the shared glyph primitives (roadmap DR-05).
 * `GrooveStaff.test.tsx` and `DrumKey.test.tsx` each prove these are wired
 * up correctly in their own context; this file only proves each shape draws
 * the right kind of element, since both callers depend on that being true.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AccentMark, NoteheadShape, OpenMark } from './NoteGlyphs.tsx'

afterEach(cleanup)

describe('NoteheadShape', () => {
  it('draws a filled ellipse for normal, and no ellipse for the other three', () => {
    const { container: normal } = render(
      <svg>
        <NoteheadShape notehead="normal" cx={1} cy={1} />
      </svg>,
    )
    expect(normal.querySelector('ellipse')).not.toBeNull()

    for (const notehead of ['x', 'diamond', 'circleX'] as const) {
      const { container } = render(
        <svg>
          <NoteheadShape notehead={notehead} cx={1} cy={1} />
        </svg>,
      )
      expect(container.querySelector('ellipse')).toBeNull()
    }
  })

  it('gives circleX both a circle and a cross, and x only a cross', () => {
    const { container: circleX } = render(
      <svg>
        <NoteheadShape notehead="circleX" cx={1} cy={1} />
      </svg>,
    )
    expect(circleX.querySelector('circle')).not.toBeNull()
    expect(circleX.querySelectorAll('line')).toHaveLength(2)

    const { container: x } = render(
      <svg>
        <NoteheadShape notehead="x" cx={1} cy={1} />
      </svg>,
    )
    expect(x.querySelector('circle')).toBeNull()
    expect(x.querySelectorAll('line')).toHaveLength(2)
  })
})

describe('OpenMark / AccentMark', () => {
  it('centres the open circle on the given point', () => {
    const { container } = render(
      <svg>
        <OpenMark cx={5} cy={9} />
      </svg>,
    )
    const circle = container.querySelector('.groove-mark-open')
    expect(circle).toHaveAttribute('cx', '5')
    expect(circle).toHaveAttribute('cy', '9')
  })

  it('draws the accent as a three-point polyline', () => {
    const { container } = render(
      <svg>
        <AccentMark cx={5} cy={9} />
      </svg>,
    )
    const points = container.querySelector('.groove-mark-accent')?.getAttribute('points') ?? ''
    expect(points.trim().split(/\s+/)).toHaveLength(3)
  })
})
