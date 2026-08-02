import type { RampState } from '@core/timing/metronome.ts'
import { bpm } from '@core/shared/units.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TempoRampControl } from './TempoRampControl.tsx'

afterEach(cleanup)

function state(overrides: Partial<RampState> = {}): RampState {
  return { currentBpm: bpm(62), repsAtCurrent: 0, done: false, ...overrides }
}

describe('TempoRampControl', () => {
  it('is a named group with the four labelled controls', () => {
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={state()}
        nextBpm={64}
      />,
    )
    expect(screen.getByRole('group', { name: 'Tempo ramp' })).toBeInTheDocument()
    expect(screen.getByLabelText('From (bpm)')).toHaveValue(60)
    expect(screen.getByLabelText('To (bpm)')).toHaveValue(80)
    expect(screen.getByLabelText('Step (bpm)')).toHaveValue(2)
  })

  it('toggling the checkbox reports the new enabled state', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <TempoRampControl
        enabled={false}
        onToggle={onToggle}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={undefined}
        nextBpm={undefined}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Tempo ramp' }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('changing the step-bpm field reports the new value', () => {
    const onStepBpmChange = vi.fn()
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={onStepBpmChange}
        repsPerStep={1}
        state={state()}
        nextBpm={64}
      />,
    )

    fireEvent.change(screen.getByLabelText('Step (bpm)'), { target: { value: '4' } })
    expect(onStepBpmChange).toHaveBeenCalledWith(4)
  })

  it('clearing a number field does not forward a bogus 0', () => {
    const onStepBpmChange = vi.fn()
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={onStepBpmChange}
        repsPerStep={1}
        state={state()}
        nextBpm={64}
      />,
    )

    fireEvent.change(screen.getByLabelText('Step (bpm)'), { target: { value: '' } })
    expect(onStepBpmChange).not.toHaveBeenCalled()
  })

  it('shows the current rung and how many clean repetitions remain', () => {
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={2}
        state={state({ currentBpm: bpm(62), repsAtCurrent: 1 })}
        nextBpm={64}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('62 bpm — 1 clean repetition to 64 bpm')
  })

  it('uses the passed-in nextBpm rather than recomputing from stepBpm/toBpm props', () => {
    // A learner starts a ramp, then edits stepBpm/toBpm in the fields. The
    // readout must still promise the rung the running ramp will actually
    // reach (nextBpm), not one derived from the now-stale props.
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={200}
        onToBpmChange={() => {}}
        stepBpm={6}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={state({ currentBpm: bpm(62), repsAtCurrent: 0 })}
        nextBpm={64}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('to 64 bpm')
  })

  it('reports the plural "repetitions" when more than one clean pass remains', () => {
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={3}
        state={state({ currentBpm: bpm(62), repsAtCurrent: 0 })}
        nextBpm={64}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('3 clean repetitions to 64 bpm')
  })

  it('reports the target reached once the ramp is done, instead of a rep count', () => {
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={state({ currentBpm: bpm(80), done: true })}
        nextBpm={undefined}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('80 bpm — target reached')
  })

  it('shows the ramp as off when disabled and no state is given', () => {
    render(
      <TempoRampControl
        enabled={false}
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={undefined}
        nextBpm={undefined}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Tempo ramp is off')
  })

  // Kills a mutant that drops `disabled` from any one input's `disabled`
  // expression — REQ-3.3.4: the ramp controls must go visibly inert during an
  // assessment run.
  it('disables every control when disabled is set, even while enabled', () => {
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={state()}
        nextBpm={64}
        disabled
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Tempo ramp' })).toBeDisabled()
    expect(screen.getByLabelText('From (bpm)')).toBeDisabled()
    expect(screen.getByLabelText('To (bpm)')).toBeDisabled()
    expect(screen.getByLabelText('Step (bpm)')).toBeDisabled()
  })

  // Flip side: `disabled` defaults to false.
  it('leaves the controls enabled when disabled is not set', () => {
    render(
      <TempoRampControl
        enabled
        onToggle={() => {}}
        fromBpm={60}
        onFromBpmChange={() => {}}
        toBpm={80}
        onToBpmChange={() => {}}
        stepBpm={2}
        onStepBpmChange={() => {}}
        repsPerStep={1}
        state={state()}
        nextBpm={64}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Tempo ramp' })).toBeEnabled()
  })
})
