/**
 * `DrumsMetronomeScreen` — thin, per the testing rules: what is asserted here
 * is wiring and accessible names (roles present, Start toggles, radiogroups
 * reflect selection). Timing, gap grading, mute and ramp behaviour are all
 * `useDrumsMetronome.test.ts`'s job.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock } from '@test/fakes.ts'
import { describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { DrumsMetronomeScreen } from './DrumsMetronomeScreen.tsx'

/** A `DrumAudioOutput` this file never asserts against — see `useDrumsMetronome.test.ts`. */
function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup() {
  const clock = new FakeClock()
  const audio = fakeDrumAudio(clock)
  const driver: FrameDriver = () => () => {}
  const user = userEvent.setup()
  render(<DrumsMetronomeScreen clock={clock} audio={audio} driver={driver} />)
  return { user }
}

describe('DrumsMetronomeScreen', () => {
  it('renders the header, transport, and both segmented controls', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Metronome' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Subdivision' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Click on' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Beat' })).toHaveTextContent('Stopped')
    expect(screen.getByRole('status', { name: 'Return' })).toBeInTheDocument()
  })

  it('Start toggles to Stop and back', async () => {
    const { user } = setup()
    const button = screen.getByRole('button', { name: 'Start' })
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Beat' })).not.toHaveTextContent('Stopped')

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Beat' })).toHaveTextContent('Stopped')
  })

  it('the Subdivision radiogroup reflects the selected option', async () => {
    const { user } = setup()
    const three = screen.getByRole('radio', { name: '3 clicks per beat' })
    expect(three).toHaveAttribute('aria-checked', 'false')
    await user.click(three)
    expect(three).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '1 click per beat' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('the Click on radiogroup reflects the selected placement', async () => {
    const { user } = setup()
    const twoAndFour = screen.getByRole('radio', { name: '2 & 4' })
    expect(twoAndFour).toHaveAttribute('aria-checked', 'false')
    await user.click(twoAndFour)
    expect(twoAndFour).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'All beats' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('the timing games disclosure is closed by default and reveals its fields when opened', async () => {
    const { user } = setup()
    expect(screen.queryByLabelText('Bars on')).not.toBeVisible()
    await user.click(screen.getByText('Timing games'))
    expect(screen.getByLabelText('Bars on')).toBeVisible()
    expect(screen.getByLabelText('Subdivision volume')).toBeVisible()
  })
})
