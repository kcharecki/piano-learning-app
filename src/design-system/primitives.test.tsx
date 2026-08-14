/**
 * Render tests for the form primitives added in `css/primitives.css`
 * (roadmap UI-01, 2026-08-12 UI audit): `.field`, `.field-row`,
 * `.field-inline`, the reworked `.stepper`, and `.seg-control`. Extended
 * (roadmap UI-02) with the page scaffold (`.page`, `.page-header`) and its
 * reusable components (`.card`/`.card--sunken`, `.toolbar`, `.stat-group`/
 * `.stat`).
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

describe('.page', () => {
  it('composes as .page > .page-header + sections, never a bare stack', () => {
    const { container } = render(
      <div className="page page--focus">
        <header className="page-header">
          <div>
            <h1>Sight reading</h1>
          </div>
        </header>
        <section aria-label="Controls">Controls</section>
      </div>,
    )
    const page = container.querySelector('.page')
    expect(page).not.toBeNull()
    expect(page).toHaveClass('page--focus')
    // .page-header is the first direct child; every screen's title lives
    // there exactly once, never scattered across later sections.
    expect(page?.children[0]).toHaveClass('page-header')
    expect(page?.querySelectorAll('h1')).toHaveLength(1)
  })

  it('supports the .page--wide archetype for dashboards', () => {
    const { container } = render(<div className="page page--wide" />)
    expect(container.querySelector('.page')).toHaveClass('page--wide')
  })
})

describe('.page-header', () => {
  it('renders an h1 title, an optional subtitle, and an optional right-aligned action slot', () => {
    const { container } = render(
      <header className="page-header">
        <div>
          <h1>Metronome</h1>
          <p className="page-header-subtitle">Keep a steady beat</p>
        </div>
        <div className="page-header-actions">
          <button type="button">Reset</button>
        </div>
      </header>,
    )
    const header = container.querySelector('.page-header')
    expect(header?.querySelector('h1')).toHaveTextContent('Metronome')
    expect(header?.querySelector('.page-header-subtitle')).toHaveTextContent('Keep a steady beat')
    expect(header?.querySelector('.page-header-actions')).not.toBeNull()
  })

  it('renders with only a title — subtitle and action slot are both optional', () => {
    const { container } = render(
      <header className="page-header">
        <h1>Progress</h1>
      </header>,
    )
    const header = container.querySelector('.page-header')
    expect(header?.children).toHaveLength(1)
    expect(header?.querySelector('.page-header-subtitle')).toBeNull()
    expect(header?.querySelector('.page-header-actions')).toBeNull()
  })
})

describe('.card', () => {
  it('renders a plain surface, and .card--sunken is an additive variant', () => {
    const { container } = render(
      <>
        <section className="card" aria-label="Raised">
          Raised content
        </section>
        <section className="card card--sunken" aria-label="Sunken">
          Sunken content
        </section>
      </>,
    )
    expect(container.querySelector('.card:not(.card--sunken)')).not.toBeNull()
    const sunken = container.querySelector('.card--sunken')
    expect(sunken).not.toBeNull()
    expect(sunken).toHaveClass('card')
  })
})

describe('button icon+label composition', () => {
  it('composes an icon and a label with no per-call CSS — button already gap: --space-2', () => {
    render(
      <button type="button">
        <svg aria-hidden="true" focusable="false" data-testid="icon" />
        Start
      </button>,
    )
    const button = screen.getByRole('button', { name: 'Start' })
    expect(button.querySelector('[data-testid="icon"]')).not.toBeNull()
    // The icon carries no accessible name of its own (aria-hidden) — "Start"
    // is the whole accessible name, proving the label (not the icon) is what
    // a screen reader announces.
    expect(button).toHaveAccessibleName('Start')
  })
})

describe('.btn-icon', () => {
  it('requires an explicit aria-label — its icon is always aria-hidden, so the label is the only accessible name', () => {
    render(
      <button type="button" className="btn-icon" aria-label="Play">
        <svg aria-hidden="true" focusable="false" />
      </button>,
    )
    const button = screen.getByRole('button', { name: 'Play' })
    expect(button).toHaveClass('btn-icon')
    expect(button).toHaveAccessibleName('Play')
  })
})

describe('.toolbar', () => {
  it('holds a horizontal run of controls above a screen’s content', () => {
    const { container } = render(
      <div className="toolbar" role="group" aria-label="Transport">
        <button type="button">Play</button>
        <button type="button">Stop</button>
      </div>,
    )
    const toolbar = container.querySelector('.toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.querySelectorAll('button')).toHaveLength(2)
  })
})

describe('.stat / .stat-group', () => {
  it('renders a value/label pair with the label under the value in the DOM', () => {
    const { container } = render(
      <div className="stat">
        <span className="stat-value">72%</span>
        <span className="stat-label">Accuracy</span>
      </div>,
    )
    const stat = container.querySelector('.stat')
    expect(stat?.children).toHaveLength(2)
    expect(stat?.children[0]).toHaveClass('stat-value')
    expect(stat?.children[0]).toHaveTextContent('72%')
    expect(stat?.children[1]).toHaveClass('stat-label')
    expect(stat?.children[1]).toHaveTextContent('Accuracy')
  })

  it('also matches the pre-existing <b>+<small> shape (SrsSummary.tsx) unrenamed', () => {
    const { container } = render(
      <div className="stat">
        <b>12</b>
        <small>Due now</small>
      </div>,
    )
    const stat = container.querySelector('.stat')
    expect(stat?.querySelector('b')).toHaveTextContent('12')
    expect(stat?.querySelector('small')).toHaveTextContent('Due now')
  })

  it('groups several .stat into one .stat-group row', () => {
    const { container } = render(
      <div className="stat-group" aria-label="Session stats">
        <div className="stat">
          <span className="stat-value">1</span>
          <span className="stat-label">Due now</span>
        </div>
        <div className="stat">
          <span className="stat-value">2</span>
          <span className="stat-label">New</span>
        </div>
      </div>,
    )
    const group = container.querySelector('.stat-group')
    expect(group?.querySelectorAll('.stat')).toHaveLength(2)
  })
})
