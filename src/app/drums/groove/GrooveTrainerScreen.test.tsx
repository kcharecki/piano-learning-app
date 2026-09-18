/**
 * `GrooveTrainerScreen` — thin, per the testing rules: what is asserted here
 * is wiring and accessible names, not grading (that is `grade.test.ts`) and
 * not timing (that is `useGrooveRun.test.ts`).
 *
 * The exception is the Space key. Its phase gate (T.17.4) is a screen-level
 * rule, it has no home in core, and getting it wrong is silent: the learner
 * starts with the mouse, Start keeps focus, and their first kick presses Stop.
 * Both directions of that gate are pinned below.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import { midi, millis } from '@core/shared/units.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { GrooveTrainerScreen } from './GrooveTrainerScreen.tsx'

/** The money beat's shape at 80 bpm — one bar of count-in, two graded. */
const BAR_MS = 3000
const GRADED_MS = 6000

/**
 * A `DrumAudioOutput` this file never asserts against — it exists only so
 * pressing a pad or starting a run has something to call. What the port is
 * actually told is pinned in `useGrooveRun.test.ts`, against a fake that
 * records it.
 */
function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup(opts: { readonly midiInput?: FakeMidiInput } = {}) {
  const clock = new FakeClock()
  const audio = fakeDrumAudio(clock)
  let frame: (() => void) | undefined
  const frameDriver: FrameDriver = (cb) => {
    frame = cb
    return () => {
      frame = undefined
    }
  }
  const user = userEvent.setup()
  render(
    <GrooveTrainerScreen
      clock={clock}
      audio={() => audio}
      frameDriver={frameDriver}
      {...(opts.midiInput === undefined ? {} : { midiInput: opts.midiInput })}
    />,
  )
  return {
    user,
    clock,
    audio,
    frameAt: (ms: number) =>
      act(() => {
        clock.setTime(ms)
        frame?.()
      }),
  }
}

function runState(): string {
  return screen.getByRole('status', { name: 'Run state' }).textContent ?? ''
}

function lastHitText(): string {
  return screen.getByRole('status', { name: 'Last hit' }).textContent ?? ''
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

describe('GrooveTrainerScreen', () => {
  it('opens on the easiest groove, at the persona’s goal tempo, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Groove trainer' })).toBeInTheDocument()
    expect(screen.getByText('Quarter-Note Rock')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(80)
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(runState()).toBe('Ready when you are')
  })

  it('steps through the library and shows the pads the chosen groove actually uses', async () => {
    const { user } = setup()
    expect(screen.queryByRole('button', { name: 'Open hi-hat' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    expect(screen.getByText('Money Beat')).toBeInTheDocument()
    for (const pad of ['Hi-hat', 'Snare', 'Kick']) {
      expect(screen.getByRole('button', { name: pad })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Open hi-hat' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    expect(screen.getByText('Money Beat (Open Hat)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open hi-hat' })).toBeInTheDocument()
  })

  /**
   * The keys used to be named twice — once per pad in `DrumKey`'s legend,
   * once more in a standalone hint paragraph — and the two fell out of sync
   * enough for an e2e spec's own text query to match both (roadmap DR-09
   * cleanup). `DrumKey` is the one place that now names a pad's key, so this
   * is thin wiring: the legend carries every pad's name and its key.
   */
  it('says what the keys are, because the persona has no kit', () => {
    setup()
    const legend = screen.getByRole('list').textContent ?? ''
    expect(legend).toMatch(/Hi-hat/)
    expect(legend).toMatch(/J/)
    expect(legend).toMatch(/Snare/)
    expect(legend).toMatch(/F/)
    expect(legend).toMatch(/Kick/)
    expect(legend).toMatch(/Space/)
  })

  it('states the tolerance on screen rather than burying it in the grader', () => {
    setup()
    expect(screen.getByText(/within 100 ms/)).toBeInTheDocument()
  })

  /** T.17.4, the outward half: outside a run, Space belongs to whatever has focus. */
  it('lets Space activate the focused control when no run is on', async () => {
    const { user } = setup()
    screen.getByRole('button', { name: 'Start' }).focus()
    await user.keyboard(' ')

    expect(runState().startsWith('Counting in')).toBe(true)
    expect(screen.getByRole('button', { name: 'Kick' })).not.toHaveAttribute('data-lit')
  })

  /** T.17.4, the inward half: once a run is on, Space is the kick and Stop cannot steal it. */
  it('takes Space for the kick while a run is on, without stopping the run', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(runState().startsWith('Counting in')).toBe(true)

    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute('data-lit', 'true')
    expect(runState().startsWith('Counting in')).toBe(true)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('plays the letter-key pads too, and ignores keys typed into the tempo field', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    await user.keyboard('f')
    expect(screen.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-lit', 'true')

    await user.clear(screen.getByRole('spinbutton', { name: /tempo/i }))
    await user.type(screen.getByRole('spinbutton', { name: /tempo/i }), '70')
    expect(screen.getByRole('button', { name: 'Hi-hat' })).not.toHaveAttribute('data-lit')
  })

  it('retunes the whole run when the tempo changes', async () => {
    const { user } = setup()
    const tempo = screen.getByRole('spinbutton', { name: /tempo/i })
    await user.clear(tempo)
    await user.type(tempo, '70{Enter}')
    expect(screen.getByText(/at 70 bpm/)).toBeInTheDocument()
  })

  it('shows no result region until a run has actually finished', () => {
    setup()
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()
  })

  it('grades a finished run per pad and records it as the last attempt', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))

    frameAt(BAR_MS)
    expect(runState()).toBe('Playing — bar 1 of 2')
    frameAt(BAR_MS + GRADED_MS)

    const result = screen.getByRole('region', { name: 'Result' })
    expect(result).toBeInTheDocument()
    // Nothing was played, so every limb is missing and the verdict says so —
    // it must not read as a pass just because no wrong note was struck.
    expect(screen.getByText('Not there yet')).toBeInTheDocument()
    expect(screen.getByText('Hi-hat — 0 of 16, 16 missed')).toBeInTheDocument()
    expect(screen.getByText(/Nothing registered/)).toBeInTheDocument()
    // Always shown, so the figures on screen say what tempo produced them —
    // see the T.31 test below for why this cannot be dropped once retuned.
    expect(screen.getByText('Graded at 80 bpm')).toBeInTheDocument()

    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.grooveTitle).toBe('Money Beat')
    expect(attempts[0]?.bpm).toBe(80)
    expect(attempts[0]?.steady).toBe(false)
    // The stale summary of the PREVIOUS session gives way to this run, so the
    // screen never carries two verdicts at once.
    expect(screen.queryByText(/^Last run:/)).not.toBeInTheDocument()
  })

  /**
   * Roadmap T.31. A result is a marking OF something: the groove it was
   * played against, not the tempo it happened to be played at. Retuning
   * after a run does not un-grade it — the panel keeps naming the tempo it
   * was actually graded at — but picking a different groove is a different
   * chart, and the marking must not survive under it.
   */
  it('keeps the result across a tempo change, but retires it when the groove changes', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS + GRADED_MS)

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Graded at 80 bpm')).toBeInTheDocument()

    const tempo = screen.getByRole('spinbutton', { name: /tempo/i })
    await user.clear(tempo)
    await user.type(tempo, '90{Enter}')

    // Retuned, not retired: the panel is still the one the learner just read,
    // and it still says the tempo IT was graded at, not the new setting.
    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Graded at 80 bpm')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(90)

    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()

    // And not merely hidden: cycling back to the graded groove does not
    // resurrect a verdict for a run that never happened at this tempo.
    await user.click(screen.getByRole('button', { name: 'Previous groove' }))
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()
  })

  /**
   * The other side of that: a learner arriving with history and no run of their
   * own sees what they last played, named and dated by tempo rather than a bare
   * "you have practised before".
   */
  it('greets a returning learner with the run they actually last played', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 92,
          at: 1_700_000_000_000,
          steady: true,
        },
      ],
    })
    setup()
    expect(screen.getByText('Last run: Money Beat at 92 bpm — steady')).toBeInTheDocument()
  })

  it('says where every millisecond figure came from, next to the figures', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS + GRADED_MS)
    expect(screen.getByRole('region', { name: 'Result' }).textContent ?? '').toMatch(
      /keyboard and speakers/,
    )
  })

  /**
   * The Rival-seat MAJOR: the persona does not already know the groove, and
   * every shipping rival lets a learner hear the pattern first. The audio
   * itself is proven against a recording fake in `useGrooveRun.test.ts`; what
   * belongs here is the wiring — the button's own label, and that it does not
   * quietly disable the very control (Start) a learner reaches for next.
   */
  describe('Listen', () => {
    it('lets the learner hear the groove before playing it, then hands Start back', async () => {
      const { user, frameAt } = setup()
      expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Listen' }))
      expect(runState()).toBe('Listening — the groove as written')
      expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument()
      // Not disabled by a run that never started — only a graded run may gate Start.
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()

      // The preview's own span elapses on its own; nothing here presses Stop.
      // That span is the GRADED span, not one bar — the staff above says `×2`
      // and the run grades two, so the demonstration lasts two.
      frameAt(BAR_MS)
      expect(runState()).toBe('Listening — the groove as written')
      frameAt(GRADED_MS)
      expect(runState()).toBe('Ready when you are')
      expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    })

    it('lets Stop listening cancel a preview early', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))
      expect(runState()).toBe('Listening — the groove as written')

      await user.click(screen.getByRole('button', { name: 'Stop listening' }))
      expect(runState()).toBe('Ready when you are')
      expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    })

    it('disables the groove picker and the tempo field during a preview, same as during a run', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))

      expect(screen.getByRole('button', { name: 'Next groove' })).toBeDisabled()
      expect(screen.getByRole('spinbutton', { name: /tempo/i })).toBeDisabled()
      // Listen itself stays reachable, so the learner can stop and re-listen.
      expect(screen.getByRole('button', { name: 'Stop listening' })).toBeEnabled()
    })

    it('is disabled while a graded run is on', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      expect(screen.getByRole('button', { name: 'Listen' })).toBeDisabled()
    })

    /**
     * `running`, not `busy`, gates Space (T.17.4) — a preview must never
     * borrow the learner's own kick key.
     */
    it('does not let Space become the kick during a preview', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))
      await user.keyboard(' ')
      expect(screen.getByRole('button', { name: 'Kick' })).not.toHaveAttribute('data-lit')
    })

    it('still lights a pad struck during a preview — a learner tapping along is not an error', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))
      await user.keyboard('f')
      expect(screen.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-lit', 'true')
    })
  })

  /**
   * Loop mode (roadmap DR-09 "loop"): a switch beside Listen, and once a pass
   * has graded, a running tally line above the verdict. The timing itself —
   * two passes off one count-in, boundary hit assignment, click scheduling —
   * is `useGrooveRun.test.ts`'s job; this is wiring and accessible names.
   */
  /**
   * Per-hit live feedback (roadmap DR-09): a status line and a colour on the
   * pad for every ACCEPTED hit, not just a verdict at the end. The grading
   * itself (`judgeLiveHit`) is proven in `liveHit.test.ts`; this is wiring —
   * that `useGrooveRun.lastHit` reaches both the status line and the right
   * pad's `data-verdict`.
   */
  describe('live hit feedback', () => {
    it('shows nothing for Last hit before any hit lands', () => {
      setup()
      expect(lastHitText()).toBe('')
    })

    it('gives the struck pad a live verdict, in the status line and as a colour on the pad itself', async () => {
      const { user, frameAt } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      frameAt(BAR_MS)

      await user.keyboard(' ')
      expect(lastHitText()).toBe('Kick on time, +0 ms')
      expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute(
        'data-verdict',
        'on-time',
      )
      // Only the struck pad carries the colour — not every pad on screen.
      expect(screen.getByRole('button', { name: 'Hi-hat' })).not.toHaveAttribute('data-verdict')
    })

    /**
     * MAJOR finding 1: Quarter-Note Rock's kick and hi-hat share an instant
     * at the very start of every bar, so a learner striking both at once
     * must not have the second pointerdown's `lastHit` overwrite the first
     * pad's own `data-verdict` — each pad is driven by `hitByPad` now.
     */
    it('keeps a live verdict on each pad when two hits land at the same instant (unison)', async () => {
      const { user, frameAt } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      frameAt(BAR_MS)

      await user.keyboard(' ') // kick, instant 0
      await user.keyboard('j') // hi-hat, also instant 0

      expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute(
        'data-verdict',
        'on-time',
      )
      expect(screen.getByRole('button', { name: 'Hi-hat' })).toHaveAttribute(
        'data-verdict',
        'on-time',
      )
    })

    it('reads a hit with nothing expected at that instant as extra, both in text and as the pad’s colour', async () => {
      const { user, frameAt } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      frameAt(BAR_MS)
      // Quarter-Note Rock's snare falls on 750/2250/3750/5250ms into the
      // graded window; 2000ms in is 250ms from the nearest of those — well
      // outside the 100ms window this groove grades at.
      frameAt(BAR_MS + 2000)

      await user.keyboard('f')
      expect(lastHitText()).toBe('Snare — nothing written there')
      expect(screen.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-verdict', 'extra')
    })
  })

  describe('Loop', () => {
    it('is off by default, toggles on click, and is disabled while a run is on', async () => {
      const { user } = setup()
      const toggle = screen.getByRole('switch', { name: 'Loop' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
      expect(toggle).toBeEnabled()

      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-checked', 'true')

      await user.click(screen.getByRole('button', { name: 'Start' }))
      expect(toggle).toBeDisabled()
      // And it stayed on — Start does not reset a setting the learner just chose.
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })

    it('shows no tally before any pass has graded, then a running one that survives Stop', async () => {
      const { user, frameAt } = setup()
      await user.click(screen.getByRole('button', { name: 'Next groove' }))
      await user.click(screen.getByRole('switch', { name: 'Loop' }))
      await user.click(screen.getByRole('button', { name: 'Start' }))

      frameAt(BAR_MS)
      expect(runState()).toBe('Playing — bar 1 of 2, pass 1')
      expect(screen.queryByText(/passes? steady/)).not.toBeInTheDocument()

      // Nothing played, so pass 1 grades not-steady, but it DID grade — the
      // run keeps going (only Stop ends a loop run), now on pass 2.
      frameAt(BAR_MS + GRADED_MS + 100)
      expect(runState()).toBe('Playing — bar 1 of 2, pass 2')
      expect(screen.getByText('0 of 1 pass steady')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Stop' }))
      expect(runState()).toBe('Ready when you are')
      // The tally from the pass that graded survives Stop — it is the record
      // of what actually happened, not a live readout that vanishes with it.
      expect(screen.getByText('0 of 1 pass steady')).toBeInTheDocument()
    })
  })

  describe('Mute (roadmap DR-09 "per-limb mute")', () => {
    /**
     * `setup()`'s own `fakeDrumAudio` is a no-op stub — nothing here needs to
     * assert against it elsewhere in the file, so it never records a call.
     * The one test below that needs to see a strike gets its own small
     * recording fake instead of teaching the shared stub to remember things
     * every other test would then carry too.
     */
    function setupWithRecordingAudio() {
      const clock = new FakeClock()
      const strikes: { pad: string }[] = []
      const audio: DrumAudioOutput = {
        strike: (pad) => {
          strikes.push({ pad })
        },
        click: () => {},
        allNotesOff: () => {},
        setVolume: () => {},
        now: () => clock.now(),
      }
      // No frames are pumped in the one test that uses this setup — `start()`
      // schedules pass 0's strikes synchronously, before any frame runs.
      const frameDriver: FrameDriver = () => () => {}
      const user = userEvent.setup()
      render(<GrooveTrainerScreen clock={clock} audio={() => audio} frameDriver={frameDriver} />)
      return { user, strikes }
    }

    it('shows one switch per pad, named "Play <label>", all on by default', () => {
      setup()
      for (const label of ['Kick', 'Snare', 'Hi-hat']) {
        const toggle = screen.getByRole('switch', { name: `Play ${label}` })
        expect(toggle).toHaveAttribute('aria-checked', 'true')
        expect(toggle).toBeEnabled()
      }
    })

    it('switching a pad off unchecks it and marks its pad dashed, without touching the others', async () => {
      const { user } = setup()
      const kickToggle = screen.getByRole('switch', { name: 'Play Kick' })

      await user.click(kickToggle)
      expect(kickToggle).toHaveAttribute('aria-checked', 'false')
      expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute('data-muted', 'true')

      const snareToggle = screen.getByRole('switch', { name: 'Play Snare' })
      expect(snareToggle).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('button', { name: 'Snare' })).not.toHaveAttribute('data-muted')
    })

    it('will not let the last pad still on be switched off', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('switch', { name: 'Play Kick' }))
      await user.click(screen.getByRole('switch', { name: 'Play Snare' }))

      const hatToggle = screen.getByRole('switch', { name: 'Play Hi-hat' })
      expect(hatToggle).toHaveAttribute('aria-checked', 'true')
      expect(hatToggle).toBeDisabled()
    })

    it('disables every switch once a run is on', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      for (const label of ['Kick', 'Snare', 'Hi-hat']) {
        expect(screen.getByRole('switch', { name: `Play ${label}` })).toBeDisabled()
      }
    })

    it('starting a run with a pad muted has the app strike that pad itself', async () => {
      const { user, strikes } = setupWithRecordingAudio()
      await user.click(screen.getByRole('switch', { name: 'Play Kick' }))
      await user.click(screen.getByRole('button', { name: 'Start' }))
      expect(strikes.some((s) => s.pad === 'kick')).toBe(true)
    })

    /**
     * F5: `hitByPad` survives a finished run (by design — see
     * `useGrooveRun`'s module comment), and the mute switches are enabled
     * again the moment that run grades. Without this fix a pad could carry
     * BOTH `data-muted="true"` and a `data-verdict` left over from the run
     * before it was muted.
     */
    it('drops a stale verdict from a finished run when the pad is muted afterward', async () => {
      const { user, frameAt } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      frameAt(BAR_MS)

      await user.keyboard(' ') // kick, on time
      expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute(
        'data-verdict',
        'on-time',
      )

      frameAt(BAR_MS + GRADED_MS)
      expect(runState()).toBe('Run finished')
      // The verdict survives the run finishing, same as `hitByPad` does.
      expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute(
        'data-verdict',
        'on-time',
      )

      await user.click(screen.getByRole('switch', { name: 'Play Kick' }))
      const kickPad = screen.getByRole('button', { name: 'Kick' })
      expect(kickPad).toHaveAttribute('data-muted', 'true')
      expect(kickPad).not.toHaveAttribute('data-verdict')
    })
  })

  describe('e-kit input (roadmap DR-02)', () => {
    it('says no kit is connected when Web MIDI is unavailable, and that the pads still work', async () => {
      setup()
      const status = screen.getByRole('status', { name: 'E-kit' })
      expect(status.textContent).toMatch(/^No e-kit/)
      await screen.findByText(/^No e-kit: Web MIDI API is not available/)
    })

    it('names the connected kit and map, and grades a real stroke like a pad tap', async () => {
      const kit = new FakeMidiInput()
      const { user, clock, frameAt } = setup({ midiInput: kit })
      const name = kit.listDevices()[0]?.name ?? ''
      expect(screen.getByRole('status', { name: 'E-kit' })).toHaveTextContent(
        `E-kit: ${name} · General MIDI map`,
      )

      await user.click(screen.getByRole('button', { name: 'Start' }))
      frameAt(BAR_MS)
      expect(runState()).toMatch(/^Playing/)

      // GM 38 = acoustic snare, on the first graded instant (snare on beat 2).
      clock.setTime(BAR_MS + 750)
      act(() => {
        kit.emit({ type: 'noteOn', note: midi(38), velocity: 100, time: millis(clock.now()) })
      })
      expect(lastHitText()).toContain('Snare')
      expect(screen.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-verdict', 'on-time')
    })
  })
})
