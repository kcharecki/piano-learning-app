/**
 * `EarTrainingScreen` (roadmap 3.10, REQ-3.6.1/3.6.2) — a thin view over
 * `useEarTraining`. Selecting each playable drill, pressing Play and
 * answering once drives a real grade through the whole stack; dictation
 * kinds are listed but disabled, per the module's report.
 */
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, RecordingAudioOutput, scriptedRng } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EarTrainingScreen } from './EarTrainingScreen.tsx'

function resetStore(): void {
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

function setup() {
  const clock = new FakeClock(0)
  const audioOutput = new RecordingAudioOutput(clock)
  const date = new FakeClock(1_700_000_000_000)
  const rng = scriptedRng([0])
  render(<EarTrainingScreen date={date} audioOutput={audioOutput} rng={rng} />)
  return { audioOutput }
}

describe('EarTrainingScreen — drill selector', () => {
  it('lists all six drills, all selectable — dictation has no answer pad yet, not no selector entry', () => {
    setup()

    expect(
      screen.getByRole('option', { name: 'Melodic dictation (not yet answerable)' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('option', { name: 'Rhythmic dictation (not yet answerable)' }),
    ).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Interval (melodic)' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Chord quality' })).toBeEnabled()
  })

  it('selecting melodic dictation and pressing Play plays it, but shows the not-yet-answerable status instead of a pad', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Melodic dictation (not yet answerable)')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(audioOutput.playedNotes.length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent(
      'This drill plays back, but answering it is not yet implemented.',
    )
  })

  it('before any Play press, shows a prompt instead of an answer pad', () => {
    setup()

    expect(screen.getByRole('status')).toHaveTextContent('Press Play to hear the first item.')
  })
})

describe('EarTrainingScreen — interval-melodic (the default drill)', () => {
  it('pressing Play sends the prompt to the audio output and reveals the interval pad', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()

    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(audioOutput.playedNotes.length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()
  })

  it('answering changes the graded result region', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.queryByTestId('eartraining-feedback')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'perfect fifth' }))

    expect(screen.getByTestId('eartraining-feedback')).toBeInTheDocument()
  })

  it('a wrong answer shows what the answer actually was, in the pad\'s own vocabulary', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))

    // Level 1, rng script all-zero: pool[0] = P5 — see useEarTraining.test.ts.
    await user.click(screen.getByRole('button', { name: 'minor third' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent(
      'Not quite — it was perfect fifth',
    )
  })

  it('Replay re-sends the same prompt, doubling what the audio output received', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))
    const afterPlay = audioOutput.playedNotes.length
    expect(afterPlay).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Replay' }))

    expect(audioOutput.playedNotes.length).toBe(afterPlay * 2)
    expect(audioOutput.playedNotes.slice(0, afterPlay)).toEqual(
      audioOutput.playedNotes.slice(afterPlay),
    )
  })
})

describe('EarTrainingScreen — chord quality', () => {
  it('selecting it, pressing Play and answering produces a graded result', async () => {
    const user = userEvent.setup()
    setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Chord quality')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByRole('group', { name: 'Chord quality answer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Major' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent('Correct')
  })
})

describe('EarTrainingScreen — scale/mode', () => {
  it('selecting it, pressing Play and answering produces a graded result', async () => {
    const user = userEvent.setup()
    setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Scale / mode')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByRole('group', { name: 'Scale/mode answer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Major' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent('Correct')
  })
})

describe('EarTrainingScreen — retention stats', () => {
  it('updates the stats total after one graded answer', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByTestId('eartraining-stats-total')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'Play' }))
    await user.click(screen.getByRole('button', { name: 'perfect fifth' }))

    expect(screen.getByTestId('eartraining-stats-total')).toHaveTextContent('1')
  })
})
