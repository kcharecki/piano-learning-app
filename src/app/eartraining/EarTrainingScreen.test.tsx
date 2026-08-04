/**
 * `EarTrainingScreen` (roadmap 3.10, REQ-3.6.1/3.6.2) — a thin view over
 * `useEarTraining`. Selecting each playable drill, pressing Play and
 * answering once drives a real grade through the whole stack; dictation
 * kinds are listed but disabled, per the module's report.
 */
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { seededRng } from '@core/ports/rng.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput, scriptedRng } from '@test/fakes.ts'
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
  const midiInput = new FakeMidiInput()
  render(<EarTrainingScreen date={date} audioOutput={audioOutput} rng={rng} midiInput={midiInput} />)
  return { audioOutput, clock }
}

describe('EarTrainingScreen — drill selector', () => {
  it('lists all six drills, all selectable', () => {
    setup()

    expect(screen.getByRole('option', { name: 'Melodic dictation' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Rhythmic dictation' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Interval (melodic)' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Chord quality' })).toBeEnabled()
  })

  it('before any Play press, shows a prompt instead of an answer pad', () => {
    setup()

    // Not `getByRole('status')`: `MidiDeviceStatus` (review finding — the
    // MIDI connection is now surfaced on this screen) renders its own
    // `role="status"` element too, so this needs the exact prompt text.
    expect(screen.getByText('Press Play to hear the first item.')).toBeInTheDocument()
  })
})

describe('EarTrainingScreen — melodic dictation', () => {
  it('selecting it and pressing Play plays it and reveals the dictation answer pad', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Melodic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(audioOutput.playedNotes.length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'Dictation controls' })).toBeInTheDocument()
    expect(screen.getByTestId('dictation-note-count')).toHaveTextContent('0 notes recorded')
  })

  it('pressing back the exact prompt notes at the exact moments they played, then submitting, grades it correct with a per-note breakdown', async () => {
    const user = userEvent.setup()
    const { audioOutput, clock } = setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Melodic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    // Replay each note's own onset time (recorded by RecordingAudioOutput as
    // `at`) before pressing it back, so the answer lands on the same ticks
    // the prompt did — this is what `pressDictationNote`'s ms->tick
    // conversion is supposed to reconstruct. A stub Submit that never calls
    // gradeDictation would leave no feedback and no per-note list; a stub
    // that ignores the pressed pitches would still grade this 'Correct' even
    // for wrong notes, which the note-count assertion below guards against.
    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    for (const call of noteOns) {
      clock.setTime(call.at)
      await user.click(screen.getByRole('button', { name: `Key ${call.note}` }))
    }
    expect(screen.getByTestId('dictation-note-count')).toHaveTextContent(`${noteOns.length} note`)

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent('Correct')
    expect(screen.getByTestId('dictation-pitch-accuracy')).toHaveTextContent('100%')
    expect(screen.getByTestId('dictation-rhythm-accuracy')).toHaveTextContent('100%')
    const result = screen.getByTestId('dictation-result')
    expect(result.children).toHaveLength(noteOns.length)
    expect(result).toHaveTextContent(/^(Note \d+: correct)+$/)
  })

  it('Clear empties the recorded notes back to zero', async () => {
    const user = userEvent.setup()
    setup()
    await user.selectOptions(screen.getByLabelText('Drill'), 'Melodic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))
    const [firstKey] = screen.getAllByRole('button', { name: /^Key \d+$/ })
    if (firstKey === undefined) throw new Error('expected at least one keyboard key')
    await user.click(firstKey)
    expect(screen.getByTestId('dictation-note-count')).toHaveTextContent('1 note recorded')

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByTestId('dictation-note-count')).toHaveTextContent('0 notes recorded')
  })
})

describe('EarTrainingScreen — rhythmic dictation', () => {
  it('says any key counts, since only timing is graded', async () => {
    const user = userEvent.setup()
    setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Rhythmic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByText(/any key counts/i)).toBeInTheDocument()
  })

  // Review finding: the drill was previously "listed but disabled" here —
  // no key was ever pressed, nothing was ever submitted, only a static
  // instruction string was asserted, so this would have passed with the
  // entire rhythmic answer path deleted. That gap is exactly why the
  // tick-0 anchor bug (next test) shipped unnoticed: a melodic prompt always
  // starts at tick 0, so no test anywhere could see a late-starting prompt.
  it('pressing back a rhythmic prompt at the exact moments it played, then submitting, grades it correct', async () => {
    const user = userEvent.setup()
    const { audioOutput, clock } = setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Rhythmic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    for (const call of noteOns) {
      clock.setTime(call.at)
      await user.click(screen.getByRole('button', { name: `Key ${call.note}` }))
    }
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent('Correct')
    expect(screen.getByTestId('dictation-rhythm-accuracy')).toHaveTextContent('100%')
  })

  // Regression test for the review finding: `pressDictationNote` used to
  // hard-anchor the first press to `ticks(0)`, but a rhythmic prompt's first
  // leaf can be a rest once rests are allowed (level >= 2) — measured over
  // 1500 generated items, 18.6% of rhythmic prompts started later than tick
  // 0, and a note-perfect, rhythm-perfect playback of one graded
  // `correct: false` every time against the old anchor. Level 2 / seed 3 is
  // known (found by exhaustive search) to produce exactly such a prompt.
  // This exercises the bug through the real UI path (Play's own scheduling,
  // not a hand-built clock reading), unlike the equivalent hook-level test.
  it('a rhythmic prompt whose first onset is not tick 0, played back through the UI, still grades correct', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock(0)
    const audioOutput = new RecordingAudioOutput(clock)
    const date = new FakeClock(1_700_000_000_000)
    const midiInput = new FakeMidiInput()
    useEarTrainingStore.setState((s) => ({
      session: { ...s.session, levels: { ...s.session.levels, 'rhythmic-dictation': 2 } },
    }))
    render(
      <EarTrainingScreen
        date={date}
        audioOutput={audioOutput}
        rng={seededRng(3)}
        midiInput={midiInput}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Drill'), 'Rhythmic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    expect(noteOns[0]?.at).not.toBe(0) // confirms this seed still exercises the bug
    for (const call of noteOns) {
      clock.setTime(call.at)
      await user.click(screen.getByRole('button', { name: `Key ${call.note}` }))
    }
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent('Correct')
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
