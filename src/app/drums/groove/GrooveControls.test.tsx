/**
 * `DynamicsLegend` (review round 3, RED 3): on-screen pads carry no velocity,
 * so a mouse learner on a dynamics-notated groove (Ghost-Funk Bar) needs to
 * be told the Shift/Alt keyboard fallback exists at all. Pinned here: it
 * renders for a plan with any non-'normal' `expectedDynamics`, and renders
 * nothing at all for a plan with none (Money Beat).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ghostFunkBar, moneyBeat } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import { DynamicsLegend } from './GrooveControls.tsx'

describe('DynamicsLegend', () => {
  it('renders the Shift/Alt hint for a plan with dynamics notated (Ghost-Funk Bar)', () => {
    const plan = planGrooveRun(ghostFunkBar(), 80)
    render(<DynamicsLegend plan={plan} />)
    expect(screen.getByText('Shift = accent · Alt = ghost')).toBeInTheDocument()
  })

  it('renders nothing for a plan with no dynamics notated (Money Beat)', () => {
    const plan = planGrooveRun(moneyBeat(), 80)
    const { container } = render(<DynamicsLegend plan={plan} />)
    expect(screen.queryByText('Shift = accent · Alt = ghost')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
