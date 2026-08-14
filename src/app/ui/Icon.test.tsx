import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Icon } from './Icon.tsx'

afterEach(cleanup)

describe('Icon', () => {
  it('renders a known icon name as an svg with at least one shape', () => {
    const { container } = render(<Icon name="play" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelectorAll('path, circle, line, rect, polyline').length).toBeGreaterThan(0)
  })

  it('is always hidden from the accessibility tree — adjacent text/aria-label carries the meaning, never the icon', () => {
    const { container } = render(<Icon name="check" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('strokes with currentColor so it inherits the surrounding text color, and draws no fill', () => {
    const { container } = render(<Icon name="x" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('fill', 'none')
  })

  it('defaults to a 1em size so it scales with the control font size, with no per-call size prop', () => {
    const { container } = render(<Icon name="stop" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '1em')
    expect(svg).toHaveAttribute('height', '1em')
  })

  it('accepts an explicit size override', () => {
    const { container } = render(<Icon name="stop" size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
  })

  it('renders every one of the 24 known icon names without throwing', () => {
    const names = [
      'play',
      'pause',
      'stop',
      'record',
      'metronome',
      'keyboard',
      'ear',
      'rhythm',
      'hand',
      'book',
      'cards',
      'target',
      'chart',
      'settings',
      'midi-plug',
      'bluetooth',
      'check',
      'x',
      'chevron-down',
      'chevron-right',
      'plus',
      'minus',
      'clock',
      'flame',
    ] as const
    expect(names).toHaveLength(24)
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })

  it('an unknown icon name is a compile-time type error, not a runtime one', () => {
    // @ts-expect-error "not-a-real-icon" is not one of the 24 known IconName values
    const element = <Icon name="not-a-real-icon" />
    expect(element).toBeTruthy()
  })
})
