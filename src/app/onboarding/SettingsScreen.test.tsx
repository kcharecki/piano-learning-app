/**
 * `SettingsScreen` (roadmap UI-05): a real settings screen — Appearance,
 * Practice plan, Input, Audio — each its own card. Theme applies instantly
 * and persists through `themeStore.ts`/`persistence.ts` (round-trip covered
 * there — see `persistence.test.ts`'s "theme persistence" suite); this file
 * covers the screen's own wiring: rendering, the collapse/expand of the
 * practice-plan editor, and that flipping a theme option touches the DOM
 * the way `themeStore.ts` promises.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeMidiInput, RecordingMidiOutput } from '@test/fakes.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { ok, err } from '@core/shared/result.ts'
import type { MidiDevice, MidiOutput, Unsubscribe } from '@core/ports/midi.ts'
import {
  __resetMidiOutputRoute,
  getPreferredMidiOutputPortId,
  setPreferredMidiOutputPortId,
  type ConnectMidiOutput,
} from '@adapters/audio/audioRoute.ts'
import {
  __resetDrumAudioRouteCache,
  getDrumAudioRoute,
  setDrumAudioRoute,
} from '@adapters/audio/drumAudioRoute.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useThemeStore } from '@app/state/themeStore.ts'
import { SettingsScreen } from './SettingsScreen.tsx'

/**
 * `RecordingMidiOutput` (`@test/fakes.ts`) always lists exactly one fixed
 * device — fine for every other test in this file, but the port-picker
 * tests need a connection with several ports to choose between. Built here
 * rather than in `fakes.ts` per this slice's brief (that file is out of
 * scope for this change).
 */
class FakeMultiPortMidiOutput implements MidiOutput {
  selectedDeviceId: string | null
  private devices: readonly MidiDevice[]
  private readonly deviceHandlers = new Set<(devices: readonly MidiDevice[]) => void>()

  constructor(devices: readonly MidiDevice[], selectedDeviceId: string | null = devices[0]?.id ?? null) {
    this.devices = devices
    this.selectedDeviceId = selectedDeviceId
  }

  listDevices(): readonly MidiDevice[] {
    return this.devices
  }

  onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    this.deviceHandlers.add(handler)
    return () => this.deviceHandlers.delete(handler)
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  /**
   * Simulate hot-plug (mirrors `FakeMidiInput.setDevices`/
   * `RecordingMidiOutput.setDevices`). Never re-picks `selectedDeviceId`
   * itself — that mirrors the real `WebMidiOutputAdapter`, which leaves a
   * vanished selection alone; see this slice's report.
   */
  setDevices(devices: readonly MidiDevice[]): void {
    this.devices = devices
    for (const handler of this.deviceHandlers) handler(devices)
  }

  /** Test-only: how many `onDevicesChanged` subscribers are currently live. */
  get deviceHandlerCount(): number {
    return this.deviceHandlers.size
  }

  /**
   * Test-only: change the device list WITHOUT firing `onDevicesChanged` —
   * simulates the exact race `selectMidiOutputPort`'s "no longer listed" err
   * covers (a device vanishing in the moment between the select's last
   * render and the learner's click, before hot-plug notice arrives), which
   * `setDevices` above cannot reach since it re-renders the option list
   * immediately.
   */
  vanishSilently(id: string): void {
    this.devices = this.devices.filter((d) => d.id !== id)
  }

  noteOn(): void {}
  noteOff(): void {}
  allNotesOff(): void {}
}

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

  describe('MIDI output port (roadmap DR-06 wave 12)', () => {
    const deviceA: MidiDevice = { id: 'a', name: 'Digital Piano', manufacturer: 'Yamaha' }
    const deviceB: MidiDevice = { id: 'b', name: '', manufacturer: 'Roland' } // no name — falls back to manufacturer
    const deviceC: MidiDevice = { id: 'c', name: '', manufacturer: '' } // neither — falls back to id

    it('is absent before anything is connected', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={neverConnectsOutput} />)

      expect(screen.queryByLabelText('MIDI output port')).not.toBeInTheDocument()
    })

    it('lists every connected port, labelled name / manufacturer / id in that fallback order, with the selected one current', async () => {
      const user = userEvent.setup()
      // `connectMidiOutputRoute` re-picks a port on every connect (preferred,
      // else the first) — a persisted preference is how the SELECTED port
      // ends up being other than the first for this assertion.
      setPreferredMidiOutputPortId(deviceB.id)
      const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB, deviceC])
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      await user.click(screen.getByRole('radio', { name: 'My instrument' }))

      const select = await screen.findByLabelText('MIDI output port')
      expect(within(select).getByRole('option', { name: 'Digital Piano' })).toBeInTheDocument()
      expect(within(select).getByRole('option', { name: 'Roland' })).toBeInTheDocument()
      expect(within(select).getByRole('option', { name: 'c' })).toBeInTheDocument()
      expect(select).toHaveValue(deviceB.id)
    })

    it('choosing a different port selects it on the live output, persists it, and updates the drum note', async () => {
      const user = userEvent.setup()
      const deviceD: MidiDevice = { id: 'd', name: 'Drum Module', manufacturer: 'Roland' }
      setDrumAudioRoute('midi')
      const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceD], deviceA.id)
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )
      await screen.findByLabelText('MIDI output port')
      expect(screen.getByText('Sending to Digital Piano on channel 10.')).toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('MIDI output port'), deviceD.id)

      expect(midiOut.selectedDeviceId).toBe(deviceD.id)
      expect(getPreferredMidiOutputPortId()).toBe(deviceD.id)
      expect(screen.getByText('Sending to Drum Module on channel 10.')).toBeInTheDocument()
    })

    it('a name of "" falls back to manufacturer in the drum note too, not a blank "Sending to  on channel 10."', async () => {
      // roadmap DR-06 wave 12 review — regression test for the bug found
      // while writing the port-picker tests: `describeDrumRouteNote` used to
      // read `device?.name ?? 'your instrument'`, which only guards
      // null/undefined, so a real device with an empty (but defined) `name`
      // rendered a blank note. It must use the same name -> manufacturer ->
      // id fallback as the select's own option labels.
      setDrumAudioRoute('midi')
      const midiOut = new FakeMultiPortMidiOutput([deviceB])
      const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
      render(
        <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
      )

      expect(await screen.findByText('Sending to Roland on channel 10.')).toBeInTheDocument()
    })

    describe('hot-plug', () => {
      it('a device appearing after connect (onDevicesChanged) adds an option to the list', async () => {
        setDrumAudioRoute('midi')
        const midiOut = new FakeMultiPortMidiOutput([deviceA])
        const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
        render(
          <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
        )
        const select = await screen.findByLabelText('MIDI output port')
        expect(within(select).queryByRole('option', { name: 'Roland' })).not.toBeInTheDocument()

        act(() => {
          midiOut.setDevices([deviceA, deviceB])
        })

        expect(await within(select).findByRole('option', { name: 'Roland' })).toBeInTheDocument()
      })

      it('unmounting the screen unsubscribes from onDevicesChanged', async () => {
        setDrumAudioRoute('midi')
        const midiOut = new FakeMultiPortMidiOutput([deviceA])
        const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
        const { unmount } = render(
          <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
        )
        await screen.findByLabelText('MIDI output port')
        expect(midiOut.deviceHandlerCount).toBe(1)

        unmount()

        expect(midiOut.deviceHandlerCount).toBe(0)
        // and firing after unmount must not throw — no listener is left to
        // call a `setState` on an unmounted component.
        expect(() => midiOut.setDevices([deviceA, deviceB])).not.toThrow()
      })
    })

    // Roadmap DR-06 review AMBER 1 — the suite above only ever ADDED devices
    // via `setDevices`; this is the first REMOVAL case, and the one that
    // actually matters for "my drum module fell over mid-run": the selected
    // port itself vanishing, not a new one appearing.
    describe('the selected device is unplugged', () => {
      it('the drum note says the output is unplugged (not a false "Sending to..."), and the select keeps the stale id, disabled', async () => {
        setDrumAudioRoute('midi')
        setPreferredMidiOutputPortId(deviceB.id)
        const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB])
        const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
        render(
          <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
        )
        const select = await screen.findByLabelText('MIDI output port')
        expect(select).toHaveValue(deviceB.id)
        expect(screen.getByText('Sending to Roland on channel 10.')).toBeInTheDocument()

        act(() => {
          midiOut.setDevices([deviceA]) // deviceB — the SELECTED one — disappears; deviceA (unselected) stays
        })

        expect(
          await screen.findByText('That MIDI output is unplugged — using the built-in synth.'),
        ).toBeInTheDocument()
        expect(screen.queryByText('Sending to Roland on channel 10.')).not.toBeInTheDocument()
        // the select still reports the learner's actual (unreachable) pick,
        // not a silent fall-back to whatever now enumerates first.
        expect(select).toHaveValue(deviceB.id)
        const staleOption = within(select).getByRole('option', { name: deviceB.id })
        expect(staleOption).toBeDisabled()
      })
    })

    describe('port-select error', () => {
      it('an unlisted id renders the error under the select, in the drum note style, as an alert', async () => {
        setDrumAudioRoute('midi')
        const user = userEvent.setup()
        const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB])
        const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
        render(
          <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
        )
        const select = await screen.findByLabelText('MIDI output port')
        // the device vanishes between render and the click, with no
        // hot-plug notice yet — exactly the race `selectMidiOutputPort`'s
        // second `err` branch covers; the select's rendered options are
        // still stale (still show deviceB) at the moment of the click.
        midiOut.vanishSilently(deviceB.id)

        await user.selectOptions(select, deviceB.id)

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent('That MIDI output is no longer listed.')
        expect(alert).toHaveClass('settings-audio-note')
      })

      it('a subsequent successful pick clears the error', async () => {
        setDrumAudioRoute('midi')
        const user = userEvent.setup()
        const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB])
        const connectMidiOutput: ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
        render(
          <SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} connectMidiOutput={connectMidiOutput} />,
        )
        const select = await screen.findByLabelText('MIDI output port')
        midiOut.vanishSilently(deviceB.id)
        await user.selectOptions(select, deviceB.id)
        expect(await screen.findByRole('alert')).toBeInTheDocument()

        await user.selectOptions(select, deviceA.id) // a still-listed device succeeds

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(midiOut.selectedDeviceId).toBe(deviceA.id)
      })
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
