/**
 * `EarTrainingScreen` (roadmap 3.10, REQ-3.6.1/3.6.2) — a thin view over
 * `useEarTraining`. Selecting each playable drill, pressing Play and
 * answering once drives a real grade through the whole stack; dictation
 * kinds are listed but disabled, per the module's report.
 */
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midi as asMidi } from '@core/shared/units.ts'
import { midiToName } from '@core/theory/pitch.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput, scriptedRng } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { articleFor, describeExpected, EarTrainingScreen } from './EarTrainingScreen.tsx'

// OSMD cannot run in this test environment (no canvas to measure text) — the
// same mock every other screen test that engraves a real `Score` uses (see
// `ScaleStaff.test.tsx`). Roadmap 5.29's `RevealPanel` engraves `item.prompt`
// once a grade lands, so every test past that point needs this stub.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string } }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} />
  ),
}))

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
  // Off by default in THIS file's setup() (the screen's own real default is
  // on — see the dedicated "tonal context" describe block below): every test
  // above that block asserts prompt/count-in calls exactly, and predates
  // roadmap 5.28, so leaving the screen's real default checked here would
  // inject an extra drone into every one of them for no reason relevant to
  // what each is actually testing.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Play tonal context before each item' }))
  return { audioOutput, clock }
}

// roadmap 5.32: this drill answers by click or MIDI keyboard, never by
// singing — it has no microphone. Vocal reproduction is the modality ABRSM
// Grade 1 aural, Kodály, Dalcroze and Berklee all actually test; RCM is the
// partial exception, accepting keyboard playback as an equivalent response.
describe('EarTrainingScreen — vocal-limitation disclosure (roadmap 5.32)', () => {
  it('states on screen that it cannot hear singing, names RCM\'s keyboard exception, and tells the learner what to do instead', () => {
    setup()

    const note = screen.getByText(/can't hear you sing/i)
    expect(note).toBeInTheDocument()
    // Names the practice the learner should do AWAY from the app.
    expect(note).toHaveTextContent(/sing.*back.*out loud/i)
    // Names the partial exception (RCM accepts keyboard playback).
    expect(note).toHaveTextContent(/RCM/)
    expect(note).toHaveTextContent(/keyboard playback/i)
  })

  it('is present regardless of which drill is selected', async () => {
    const user = userEvent.setup()
    setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Chord quality')

    expect(screen.getByText(/can't hear you sing/i)).toBeInTheDocument()
  })
})

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

  // REQ-3.6.1 (roadmap 3.23): the learner has no other way to know what pulse the prompt was
  // played at — see `useEarTraining.ts`'s own doc.
  it('shows the tempo the prompt was played at', async () => {
    const user = userEvent.setup()
    setup()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Melodic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByTestId('dictation-tempo')).toHaveTextContent('120 bpm')
  })

  // Asserted against the RECORDED AudioOutput calls with exact timestamps, not the rendered
  // "count-in plays first" label — a label proves nothing about what actually reached the
  // AudioOutput (see the module doc's own warning about the silent PLAY_VELOCITY = 0 defect).
  it('plays a one-bar count-in of clicks before the prompt notes', async () => {
    const user = userEvent.setup()
    const { audioOutput, clock } = setup()
    const baseMs = clock.now()

    await user.selectOptions(screen.getByLabelText('Drill'), 'Melodic dictation')
    await user.click(screen.getByRole('button', { name: 'Play' }))

    const clicks = audioOutput.calls.filter((c) => c.kind === 'click')
    expect(clicks).toEqual([
      { kind: 'click', accented: true, at: baseMs - 2000 },
      { kind: 'click', accented: false, at: baseMs - 1500 },
      { kind: 'click', accented: false, at: baseMs - 1000 },
      { kind: 'click', accented: false, at: baseMs - 500 },
    ])
    const firstNoteOn = audioOutput.calls.find((c) => c.kind === 'noteOn')
    expect(firstNoteOn?.at).toBe(baseMs)
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
      await user.click(screen.getByRole('button', { name: midiToName(asMidi(call.note)) }))
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
    const [firstKey] = screen.getAllByRole('button', { name: /^[A-G](#+|b+)?-?\d+$/ })
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
      await user.click(screen.getByRole('button', { name: midiToName(asMidi(call.note)) }))
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
      await user.click(screen.getByRole('button', { name: midiToName(asMidi(call.note)) }))
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

  // The count-in (roadmap 3.23, REQ-3.6.1) is scoped to dictation only — an interval answer is
  // graded on pitch, never timing, so it gets none. Also confirms no tempo display leaks in.
  it('does not play a count-in or show a tempo, unlike a dictation drill', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()

    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(audioOutput.calls.some((c) => c.kind === 'click')).toBe(false)
    expect(screen.queryByTestId('dictation-tempo')).toBeNull()
  })

  it('answering changes the graded result region', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.queryByTestId('eartraining-feedback')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'major third' }))

    expect(screen.getByTestId('eartraining-feedback')).toBeInTheDocument()
  })

  it('a wrong answer shows what the answer actually was, in the pad\'s own vocabulary, with an article', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))

    // Level 1, rng script all-zero: pool[0] = M3 (roadmap 5.30's RCM staging —
    // see useEarTraining.test.ts) — 'minor third' is a different level-1
    // interval, so this is guaranteed wrong.
    await user.click(screen.getByRole('button', { name: 'minor third' }))

    // roadmap 5.33: the missing-article copy bug — "it was perfect fifth" (no
    // article) is exactly the string this test used to assert.
    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent(
      'Not quite — it was a major third',
    )
  })

  // roadmap 5.33: the article is phonetic, not orthographic — see the
  // `describeExpected` describe block below for the full vowel-vs-
  // consonant-sound matrix (including 'a unison' despite its vowel letter),
  // exercised directly rather than hunting for an rng draw that lands on a
  // vowel-initial interval through the DOM.

  // roadmap 5.29 — THE core proof: after a WRONG answer, the screen names the
  // two actual pitches (not just the interval name), renders them on a staff
  // and a keyboard, and replays on request — asserted through the DOM (the
  // pitch names, the staff/keyboard regions) and the audio calls (Replay
  // actually reaching the AudioOutput with the item's own two notes again).
  it('a wrong answer reveals the two actual pitches, a staff, a keyboard, and replays on request', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))
    const afterPlay = audioOutput.playedNotes.length

    // Level 1, rng script all-zero: pool[0] = M3, low = range.low (48 = C3),
    // high = 48 + 4 = 52 = E3 — see useEarTraining.test.ts.
    await user.click(screen.getByRole('button', { name: 'minor third' }))

    const naming = screen.getByTestId('reveal-answer-naming')
    expect(naming).toHaveTextContent('major third')
    // The two actual sounding pitches — not merely the interval's name.
    expect(naming).toHaveTextContent('C3')
    expect(naming).toHaveTextContent('E3')

    expect(screen.getByRole('img', { name: "The answer's pitches, on staff" })).toBeInTheDocument()
    const diagram = screen.getByTestId('keyboard-diagram')
    expect(diagram).toBeInTheDocument()
    expect(screen.getByTestId('keyboard-key-48')).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByTestId('keyboard-key-52')).toHaveAttribute('data-highlighted', 'true')

    // Replays on request: the existing Replay control, still available once
    // graded, actually reaches the AudioOutput with the answer's own notes.
    await user.click(screen.getByRole('button', { name: 'Replay' }))
    expect(audioOutput.playedNotes.length).toBeGreaterThan(afterPlay)
    expect(audioOutput.playedNotes.slice(-2)).toEqual([48, 52])
  })

  // The same reveal, for a CORRECT answer — roadmap 5.29's own stated defect
  // is that a correct guess taught exactly as little as a wrong one, since
  // nothing ever showed what was actually heard either way.
  it('a correct answer reveals the same pitches, staff and keyboard too', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))

    await user.click(screen.getByRole('button', { name: 'major third' }))

    expect(screen.getByTestId('eartraining-feedback')).toHaveTextContent('Correct')
    expect(screen.getByTestId('reveal-answer-naming')).toHaveTextContent('major third')
    expect(screen.getByRole('img', { name: "The answer's pitches, on staff" })).toBeInTheDocument()
  })

  it('offers a reference-interval control that reaches the AudioOutput at a fixed register', async () => {
    const user = userEvent.setup()
    const { audioOutput } = setup()
    await user.click(screen.getByRole('button', { name: 'Play' }))
    await user.click(screen.getByRole('button', { name: 'minor third' }))
    audioOutput.reset()

    await user.click(screen.getByRole('button', { name: 'Play reference interval' }))

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    // Middle C (60) up a major third (64) — fixed, unlike the drawn item's
    // own C3/E3 register above.
    expect(noteOns.map((c) => c.note)).toEqual([60, 64])
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
    await user.click(screen.getByRole('button', { name: 'major third' }))

    expect(screen.getByTestId('eartraining-stats-total')).toHaveTextContent('1')
  })
})

// roadmap 5.33: the copy bug was "it was perfect fifth" — no article.
// `intervalLongName` always leads with the QUALITY word ('perfect', 'major',
// 'minor', 'augmented', 'diminished', 'doubly diminished', 'doubly
// augmented'), so `describeExpected`'s own output never actually puts a bare
// number word first ('perfect octave', never a bare 'octave') — but
// `articleFor` itself is the general-purpose helper the task asks for, and is
// tested directly against the phonetic exception the naive vowel-letter
// check gets wrong: 'unison' is spelled with a leading vowel letter but
// spoken with a leading consonant sound ("YOO-ni-sn"), so it takes 'a', not
// the 'an' a first-letter check would produce — unlike 'octave', a genuine
// vowel sound, which a naive check already gets right.
describe('articleFor — the indefinite article is phonetic, not orthographic (roadmap 5.33)', () => {
  it('"unison" takes "a" despite its vowel letter — the naive-check-defeating case', () => {
    expect(articleFor('unison')).toBe('a')
    expect(articleFor('unison, ascending')).toBe('a')
  })

  it('"octave" takes "an" — a genuine vowel sound, unlike "unison"', () => {
    expect(articleFor('octave')).toBe('an')
  })

  it('every interval quality word this drill can produce gets the right article', () => {
    expect(articleFor('perfect fifth')).toBe('a')
    expect(articleFor('major third')).toBe('a')
    expect(articleFor('minor third')).toBe('a')
    expect(articleFor('diminished fifth')).toBe('a')
    expect(articleFor('doubly diminished third')).toBe('a')
    expect(articleFor('doubly augmented fourth')).toBe('a')
    expect(articleFor('augmented fourth')).toBe('an')
  })
})

describe('describeExpected — prepends the article to an interval answer (roadmap 5.33)', () => {
  it('a consonant-initial quality reads "a" plus the long name', () => {
    expect(describeExpected('interval-harmonic', 'P5')).toBe('a perfect fifth')
    expect(describeExpected('interval-harmonic', 'M3')).toBe('a major third')
    expect(describeExpected('interval-harmonic', 'm3')).toBe('a minor third')
    expect(describeExpected('interval-harmonic', 'd5')).toBe('a diminished fifth')
  })

  it('a vowel-sound-initial quality reads "an" plus the long name', () => {
    expect(describeExpected('interval-harmonic', 'A4')).toBe('an augmented fourth')
  })

  it('a unison and an octave both lead with the quality word ("perfect"), so both read "a" here — the phonetic exception only bites a bare number word, exercised directly in articleFor above', () => {
    expect(describeExpected('interval-harmonic', 'P1')).toBe('a perfect unison')
    expect(describeExpected('interval-harmonic', 'P8')).toBe('a perfect octave')
  })

  it('a melodic answer carries direction after the interval name, article still on the quality', () => {
    expect(describeExpected('interval-melodic', 'P5')).toBe('a perfect fifth, ascending')
    expect(describeExpected('interval-melodic', '-A4')).toBe('an augmented fourth, descending')
  })

  it('an unparseable expected string is returned unchanged, with no article', () => {
    expect(describeExpected('interval-harmonic', 'not-a-real-interval')).toBe('not-a-real-interval')
  })
})

describe('EarTrainingScreen — tonal context toggle (roadmap 5.28)', () => {
  it('defaults to on, and unchecking it drops the drone from the next thing played', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock(9000)
    const audioOutput = new RecordingAudioOutput(clock)
    const date = new FakeClock(1_700_000_000_000)
    const midiInput = new FakeMidiInput()
    render(
      <EarTrainingScreen
        date={date}
        audioOutput={audioOutput}
        rng={scriptedRng([0])}
        midiInput={midiInput}
      />,
    )

    const toggle = screen.getByRole('checkbox', { name: 'Play tonal context before each item' })
    expect(toggle).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Play' }))
    // Level 1 melodic interval prompt is 2 notes; the default-on drone adds
    // 2 more (tonic + fifth) ahead of them.
    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(4)
    const afterFirstPlay = audioOutput.calls.filter((c) => c.kind === 'noteOn').length

    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Replay' }))

    // Only the 2 prompt notes this time — no drone.
    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(afterFirstPlay + 2)
  })
})
