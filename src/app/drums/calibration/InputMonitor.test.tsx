/**
 * `InputMonitor` — thin render test. Classification/line-formatting logic is
 * proven in `@app/drums/input/monitor.test.ts`.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MonitorEntry } from '@app/drums/input/monitor.ts'
import { InputMonitor } from './InputMonitor.tsx'

function entry(seq: number, overrides: Partial<MonitorEntry> = {}): MonitorEntry {
  return {
    seq,
    atMs: seq,
    raw: { kind: 'noteOn', note: 38, velocity: 92 },
    verdict: { kind: 'pad', pad: 'snare', articulations: [] },
    ...overrides,
  }
}

describe('InputMonitor', () => {
  it('shows the empty-state status when there are no entries', () => {
    render(<InputMonitor entries={[]} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Input monitor' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Input monitor status' })).toHaveTextContent(
      'No events yet — hit a pad on your kit.',
    )
    expect(screen.queryByRole('list', { name: 'Input events' })).not.toBeInTheDocument()
  })

  it('renders entries newest-first as list items with the expected line text', () => {
    const entries: readonly MonitorEntry[] = [
      entry(3, {
        raw: { kind: 'cc', controller: 4, value: 127 },
        verdict: { kind: 'position', value: 127 },
      }),
      entry(2, { raw: { kind: 'noteOn', note: 27, velocity: 60 }, verdict: { kind: 'unmapped' } }),
      entry(1, { raw: { kind: 'noteOn', note: 38, velocity: 92 }, verdict: { kind: 'pad', pad: 'snare', articulations: [] } }),
    ]

    render(<InputMonitor entries={entries} />)

    const list = screen.getByRole('list', { name: 'Input events' })
    const items = within(list).getAllByRole('listitem')
    const lines = items.map((item) => item.querySelector('.input-monitor-line')?.textContent)
    expect(lines).toEqual([
      'CC 4 = 127 → pedal position',
      'note 27 · vel 60 → not in the map',
      'note 38 · vel 92 → Snare',
    ])
    expect(screen.queryByRole('status', { name: 'Input monitor status' })).not.toBeInTheDocument()
  })

  it('shows the gap since the older neighbour, empty for the oldest entry shown', () => {
    const entries: readonly MonitorEntry[] = [entry(2, { atMs: 1004 }), entry(1, { atMs: 1000 })]

    render(<InputMonitor entries={entries} />)

    const list = screen.getByRole('list', { name: 'Input events' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('+4 ms')
    expect(items[1]?.querySelector('.input-monitor-gap')?.textContent).toBe('')
  })
})
