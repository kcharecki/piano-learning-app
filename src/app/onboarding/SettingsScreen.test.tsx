/**
 * `SettingsScreen` (roadmap UI-05): a real settings screen — Appearance,
 * Practice plan, Input, Audio — each its own card. Theme applies instantly
 * and persists through `themeStore.ts`/`persistence.ts` (round-trip covered
 * there — see `persistence.test.ts`'s "theme persistence" suite); this file
 * covers the screen's own wiring: rendering, the collapse/expand of the
 * practice-plan editor, and that flipping a theme option touches the DOM
 * the way `themeStore.ts` promises.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeMidiInput, RecordingMidiOutput } from '@test/fakes.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { ok, err } from '@core/shared/result.ts'
import { __resetMidiOutputRoute, type ConnectMidiOutput } from '@adapters/audio/audioRoute.ts'
import {
  __resetDrumAudioRouteCache,
  getDrumAudioRoute,
  setDrumAudioRoute,
} from '@adapters/audio/drumAudioRoute.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useThemeStore } from '@app/state/themeStore.ts'
import { SettingsScreen } from './SettingsScreen.tsx'

/** Never resolves — a deterministic "no MIDI keyboard connected" state, same pattern `InputCapabilityBanner.test.tsx` uses. */
const neverConnects = (): Promise<never> => new Promise(() => {})

/** Never resolves — the Audio section's own MIDI-out connect seam, deliberately never used unless a test asks for it. */
const neverConnectsOutput: ConnectMidiOutput = () => new Promise(() => {})

afterEach(() => {
  cleanup()
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useThemeStore.setState({ theme: 'system' })
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
  // `audioRoute.ts`'s `readyMidiOutput` and `drumAudioRoute.ts`'s route cache
  // are module-level state that outlives `localStorage.clear()` — this file
  // shares one module instance across every `it()` below rather than
  // `vi.resetModules()`-ing per test, so both must be reset explicitly to
  // keep tests order-independent (review R3).
  __resetMidiOutputRoute()
  __resetDrumAudioRouteCache()
})

describe('SettingsScreen', () => {
  it('renders all four sections as cards, each with its own heading', () => {
    render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    for (const name of ['Appearance', 'Practice plan', 'Input', 'Audio']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('"Back to Today" is a real nav action', async () => {
    const user = userEvent.setup()
    const onGoToToday = vi.fn()
    render(<SettingsScreen onGoToToday={onGoToToday} connectMidi={neverConnects} />)

    await user.click(screen.getByRole('button', { name: 'Back to Today' }))
    expect(onGoToToday).toHaveBeenCalledTimes(1)
  })

  describe('Appearance', () => {
    it('exposes theme as a 3-option radiogroup, System selected by default', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      const group = screen.getByRole('radiogroup', { name: 'Theme' })
      const options = within(group).getAllByRole('radio')
      expect(options.map((o) => o.textContent)).toEqual(['System', 'Dark', 'Light'])
      expect(within(group).getByRole('radio', { name: 'System' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })

    it('selecting Light applies data-theme="light" to the root element instantly', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      await user.click(screen.getByRole('radio', { name: 'Light' }))

      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'false')
    })

    it('selecting System REMOVES data-theme rather than hardcoding a palette', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      await user.click(screen.getByRole('radio', { name: 'Dark' }))
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

      await user.click(screen.getByRole('radio', { name: 'System' }))
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    })

    it('is keyboard reachable', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      await user.tab()
      expect(screen.getByRole('button', { name: 'Back to Today' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus()
    })
  })

  describe('Practice plan', () => {
    it('is collapsed by default to a one-line summary, not the raw questionnaire', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      expect(screen.queryByRole('heading', { name: 'Set up your practice' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Finish setup' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    })

    it('Edit expands the questionnaire inline; it is the one .btn-primary on the screen', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      expect(document.querySelectorAll('.btn-primary')).toHaveLength(0)

      await user.click(screen.getByRole('button', { name: 'Edit' }))

      const primaries = document.querySelectorAll('.btn-primary')
      expect(primaries).toHaveLength(1)
      expect(primaries[0]).toHaveTextContent('Finish setup')
      // The embedded editor suppresses its own duplicate MIDI check — Input already covers it.
      expect(screen.queryByRole('heading', { name: 'Your MIDI keyboard' })).not.toBeInTheDocument()
    })

    it('Cancel collapses back to the summary without changing it', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('button', { name: 'Finish setup' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    })

    it('Finish collapses back and updates the summary to exactly what was chosen', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.click(screen.getByLabelText("I've played a bit before"))
      await user.click(screen.getByLabelText('Learn real pieces'))
      await user.click(screen.getByRole('button', { name: '60 min' }))
      await user.click(screen.getByRole('button', { name: 'Finish setup' }))

      expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
      expect(
        screen.getByText("I've played a bit before · Learn real pieces · 60 min/day"),
      ).toBeInTheDocument()
    })

    it('before any edit, the summary reflects the real, currently-set track levels — not an invented default', () => {
      useLevelStore.setState({
        levelState: {
          levels: { playing: 2, 'sight-reading': 2, theory: 2 },
          overridden: { playing: false, 'sight-reading': false, theory: false },
        },
        hydrated: true,
      })
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      expect(screen.getByText("I've played a bit before")).toBeInTheDocument()
    })
  })

  describe('Input', () => {
    it('renders MidiDeviceStatus (not a fork): shows the connected device by name', () => {
      render(
        <SettingsScreen onGoToToday={vi.fn()} midiInput={new FakeMidiInput()} />,
      )

      expect(screen.getByText(/midi keyboard connected: fake digital piano/i)).toBeInTheDocument()
    })

    it('points to the microphone on Practice as the no-keyboard alternative', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      expect(screen.getByText(/try the microphone on practice/i)).toBeInTheDocument()
    })
  })

  describe('Drum voices', () => {
    it('renders the control with the two options', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={neverConnectsOutput} />)

      const group = screen.getByRole('radiogroup', { name: 'Drum voices' })
      expect(within(group).getByRole('radio', { name: 'Built-in synth' })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: 'MIDI out (channel 10)' })).toBeInTheDocument()
    })

    // review R1 round 2: the MIDI option used to be `disabled` while
    // `connectedMidiOutput === undefined`, but that value is only ever
    // populated by the connect effect that this exact click triggers —
    // deadlock, the option could never leave disabled. Fix: never disabled;
    // clicking it sets the route immediately, the connect effect runs, and
    // the note carries the interim/settled state instead of a `disabled`
    // attribute. Kills a mutant that reintroduces the `disabled` prop.
    it('choosing MIDI out immediately checks the radio and starts the connection, with no device connected yet', async () => {
      const user = userEvent.setup()
      const midiOut = new RecordingMidiOutput()
      let resolveConnect: (result: Awaited<ReturnType<ConnectMidiOutput>>) => void = () => {}
      const connectMidiOutput = vi.fn<ConnectMidiOutput>(
        () => new Promise((resolve) => { resolveConnect = resolve }),
      )
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      await user.click(screen.getByRole('radio', { name: 'MIDI out (channel 10)' }))

      expect(screen.getByRole('radio', { name: 'MIDI out (channel 10)' })).toHaveAttribute('aria-checked', 'true')
      expect(connectMidiOutput).toHaveBeenCalled()
      expect(screen.getByText('Using the built-in synth until a MIDI output connects.')).toBeInTheDocument()

      resolveConnect(ok({ output: midiOut }))

      await waitFor(() =>
        expect(screen.getByText('Sending to Fake Digital Piano on channel 10.')).toBeInTheDocument(),
      )
      expect(getDrumAudioRoute()).toBe('midi')
    })

    it('choosing MIDI out, once a device is connected, persists the route and updates the control', async () => {
      const user = userEvent.setup()
      const midiOut = new RecordingMidiOutput()
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )
      // Establish a live MIDI-out connection via the piano's own "My
      // instrument" control — the only connection path this screen has (see
      // `getConnectedMidiOutput`'s comment: it reflects that same connection,
      // independent of which route the PIANO ends up using).
      await user.click(screen.getByRole('radio', { name: 'My instrument' }))
      await waitFor(() =>
        expect(screen.getByText('Sound: routed to your connected instrument')).toBeInTheDocument(),
      )

      await user.click(screen.getByRole('radio', { name: 'MIDI out (channel 10)' }))

      expect(getDrumAudioRoute()).toBe('midi')
      expect(screen.getByRole('radio', { name: 'MIDI out (channel 10)' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.queryByText('Using the built-in synth until a MIDI output connects.')).not.toBeInTheDocument()
      // review A5: names which device channel 10 is actually going to, not
      // just "connected" — a learner with a piano AND a kit module needs this.
      expect(screen.getByText('Sending to Fake Digital Piano on channel 10.')).toBeInTheDocument()
    })

    // review R1 round 1: `connectMidiOutputRoute` used to only run when the
    // PIANO route was 'midi', so a learner who wants MIDI drums while the
    // piano stays on Web Audio could never get a connection. Kills that
    // mutant: piano route never leaves 'webaudio' here, yet the connect
    // effect must still run once the drum route is set to 'midi'.
    it('a MIDI drum route alone (piano still on Web Audio) triggers the connection', async () => {
      setDrumAudioRoute('midi')
      const midiOut = new RecordingMidiOutput()
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      await waitFor(() =>
        expect(screen.getByText('Sending to Fake Digital Piano on channel 10.')).toBeInTheDocument(),
      )
      // the piano itself is untouched — still Built-in, never "connecting"
      expect(screen.getByRole('radio', { name: 'Built-in piano sound' })).toHaveAttribute('aria-checked', 'true')
    })

    // review round 4 AMBER 2: a failed connection (e.g. Firefox / a blocked
    // permission) used to still read as "Using the built-in synth until a
    // MIDI output connects.", implying a pending connection that will never
    // arrive. Kills a mutant that ignores `midiRouteStatus === 'error'` in
    // `describeDrumRouteNote`.
    it('a failed MIDI connection states the fallback plainly, with the real error, and leaves the piano status alone', async () => {
      const user = userEvent.setup()
      const connectMidiOutput: ConnectMidiOutput = () =>
        Promise.resolve(err('Web MIDI API is not available in this browser.'))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      await user.click(screen.getByRole('radio', { name: 'MIDI out (channel 10)' }))

      expect(screen.getByRole('radio', { name: 'MIDI out (channel 10)' })).toHaveAttribute('aria-checked', 'true')
      await waitFor(() =>
        expect(
          screen.getByText('Built-in synth: Web MIDI API is not available in this browser.'),
        ).toBeInTheDocument(),
      )
      // the piano's own status line is untouched — its route is still webaudio
      expect(screen.getByText('Sound: built-in piano sounds')).toBeInTheDocument()
    })
  })

  describe('Audio', () => {
    it('states the real current output in learner language, Built-in selected by default', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={neverConnectsOutput} />)

      expect(screen.getByText('Sound: built-in piano sounds')).toBeInTheDocument()
      const group = screen.getByRole('radiogroup', { name: 'Sound' })
      expect(within(group).getByRole('radio', { name: 'Built-in piano sound' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })

    it('selecting My instrument connects MIDI-out, auto-selects a device, and the change is reflected in the status line', async () => {
      const user = userEvent.setup()
      const midiOut = new RecordingMidiOutput()
      midiOut.selectDevice(null)
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      await user.click(screen.getByRole('radio', { name: 'My instrument' }))

      expect(screen.getByRole('radio', { name: 'My instrument' })).toHaveAttribute('aria-checked', 'true')
      await waitFor(() =>
        expect(screen.getByText('Sound: routed to your connected instrument')).toBeInTheDocument(),
      )
      // the real call the adapter needs to route Practice's notes: a device selected on the MidiOutput itself
      expect(midiOut.selectedDeviceId).not.toBeNull()
    })

    it('a connection failure falls back to the built-in sound and states why, in learner language', async () => {
      const user = userEvent.setup()
      const connectMidiOutput: ConnectMidiOutput = () =>
        Promise.resolve(err('Web MIDI API is not available in this browser.'))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      await user.click(screen.getByRole('radio', { name: 'My instrument' }))

      expect(
        await screen.findByText(/Sound: built-in piano sounds — couldn't reach your instrument/),
      ).toBeInTheDocument()
    })

    it('persists the choice — a remount (e.g. after reload) reconnects and starts on My instrument, not Built-in', async () => {
      const user = userEvent.setup()
      const midiOut = new RecordingMidiOutput()
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      const { unmount } = render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )
      await user.click(screen.getByRole('radio', { name: 'My instrument' }))
      await waitFor(() =>
        expect(screen.getByText('Sound: routed to your connected instrument')).toBeInTheDocument(),
      )
      unmount()

      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      expect(screen.getByRole('radio', { name: 'My instrument' })).toHaveAttribute('aria-checked', 'true')
      await waitFor(() =>
        expect(screen.getByText('Sound: routed to your connected instrument')).toBeInTheDocument(),
      )
    })

    it('switching back to Built-in stops offering the MIDI status and returns to idle', async () => {
      const user = userEvent.setup()
      const midiOut = new RecordingMidiOutput()
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )
      await user.click(screen.getByRole('radio', { name: 'My instrument' }))
      await waitFor(() =>
        expect(screen.getByText('Sound: routed to your connected instrument')).toBeInTheDocument(),
      )

      await user.click(screen.getByRole('radio', { name: 'Built-in piano sound' }))

      expect(screen.getByText('Sound: built-in piano sounds')).toBeInTheDocument()
    })
  })
})
