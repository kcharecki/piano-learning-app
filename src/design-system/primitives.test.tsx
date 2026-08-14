/**
 * Render tests for the form primitives added in `css/primitives.css`
 * (roadmap UI-01, 2026-08-12 UI audit): `.field`, `.field-row`,
 * `.field-inline`, the reworked `.stepper`, and `.seg-control`.
 *
 * happy-dom does not load external stylesheets, so these assert class
 * application and DOM structure — the contract each selector in
 * `primitives.css` depends on (e.g. "the label lives outside `.stepper`,
 * not between its buttons") — not computed layout, which needs a real
 * browser (the tablet touch-target and visual-pass suites cover that).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

describe('.field', () => {
  it('renders a label directly above its control, both inside the field wrapper', () => {
    const { container } = render(
      <div className="field">
        <label htmlFor="tempo">Tempo</label>
        <input id="tempo" type="number" />
      </div>,
    )
    const field = container.querySelector('.field')
    expect(field).not.toBeNull()
    expect(field?.children).toHaveLength(2)
    expect(field?.children[0]?.tagName).toBe('LABEL')
    expect(field?.children[1]?.tagName).toBe('INPUT')
    expect(screen.getByLabelText('Tempo')).toBeInTheDocument()
  })
})

describe('.field-row', () => {
  it('holds multiple .field children as a single horizontal run', () => {
    const { container } = render(
      <div className="field-row">
        <div className="field">
          <label htmlFor="a">A</label>
          <input id="a" />
        </div>
        <div className="field">
          <label htmlFor="b">B</label>
          <input id="b" />
        </div>
      </div>,
    )
    const row = container.querySelector('.field-row')
    const fields = Array.from(row?.children ?? []).filter((el) => el.classList.contains('field'))
    expect(fields).toHaveLength(2)
  })
})

describe('.field-inline', () => {
  it('keeps label and control as direct siblings on one line', () => {
    const { container } = render(
      <div className="field-inline">
        <label htmlFor="click">Metronome click</label>
        <input id="click" type="checkbox" />
      </div>,
    )
    const inline = container.querySelector('.field-inline')
    expect(inline?.children).toHaveLength(2)
  })
})

describe('.stepper', () => {
  function renderStepper() {
    return render(
      <div className="field">
        <span id="level-label">Level</span>
        <div className="stepper" aria-labelledby="level-label">
          <button type="button" aria-label="Decrease level">
            −
          </button>
          <span className="stepper-value">1</span>
          <button type="button" aria-label="Increase level">
            +
          </button>
        </div>
      </div>,
    )
  }

  it('never places the label inside the bordered group — it lives in the surrounding .field', () => {
    const { container } = renderStepper()
    const stepper = container.querySelector('.stepper')
    expect(stepper).not.toBeNull()
    // Every descendant of .stepper is part of the [-] value [+] group itself
    // (buttons + the value cell) — no label element leaked inside it.
    expect(stepper?.querySelector('label')).toBeNull()
    expect(container.querySelector('.field > span#level-label')).not.toBeNull()
  })

  it('has exactly one centered value cell between two buttons', () => {
    const { container } = renderStepper()
    const stepper = container.querySelector('.stepper')
    const children = Array.from(stepper?.children ?? [])
    expect(children.map((el) => el.tagName)).toEqual(['BUTTON', 'SPAN', 'BUTTON'])
    expect(children[1]).toHaveClass('stepper-value')
    expect(children[1]).toHaveTextContent('1')
  })

  it('exposes both step buttons by their accessible name', () => {
    renderStepper()
    expect(screen.getByRole('button', { name: 'Decrease level' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Increase level' })).toBeInTheDocument()
  })
})

describe('.seg-control', () => {
  function renderSegControl(selected: 'a' | 'b' | 'c') {
    return render(
      <div className="seg-control" role="radiogroup" aria-label="Session length">
        <button type="button" role="radio" aria-checked={selected === 'a'}>
          15 min
        </button>
        <button type="button" role="radio" aria-checked={selected === 'b'}>
          30 min
        </button>
        <button type="button" role="radio" aria-checked={selected === 'c'}>
          60 min
        </button>
      </div>,
    )
  }

  it('is a single bordered group of role="radio" segments, radiogroup-compatible', () => {
    const group = renderSegControl('b').getByRole('radiogroup', { name: 'Session length' })
    expect(group).toHaveClass('seg-control')
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3)
  })

  it('marks the selected segment via aria-checked, distinct from the others', () => {
    renderSegControl('b')
    expect(screen.getByRole('radio', { name: '30 min' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: '60 min' })).toHaveAttribute('aria-checked', 'false')
  })

  it('also supports aria-current and a plain .selected class as selection hooks', () => {
    const { container } = render(
      <div className="seg-control" role="tablist" aria-label="Mode">
        <button type="button" role="tab" aria-current="page">
          Sight-reading
        </button>
        <button type="button" role="tab">
          Clap-back
        </button>
      </div>,
    )
    expect(container.querySelector('[aria-current="page"]')).not.toBeNull()

    const { container: container2 } = render(
      <div className="seg-control">
        <button type="button" className="selected">
          Left
        </button>
        <button type="button">Right</button>
      </div>,
    )
    expect(container2.querySelector('.selected')).not.toBeNull()
  })
})
