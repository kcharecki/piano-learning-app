/**
 * `SettingsScreen` (roadmap UI-05): a real settings screen — Appearance,
 * Practice plan, Input, Audio — each its own card. Theme applies instantly
 * and persists through `themeStore.ts`/`persistence.ts` (round-trip covered
 * there — see `persistence.test.ts`'s "theme persistence" suite); this file
 * covers the screen's own wiring: rendering, the collapse/expand of the
 * practice-plan editor, and that flipping a theme option touches the DOM
 * the way `themeStore.ts` promises.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeMidiInput } from '@test/fakes.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useThemeStore } from '@app/state/themeStore.ts'
import { SettingsScreen } from './SettingsScreen.tsx'

/** Never resolves — a deterministic "no MIDI keyboard connected" state, same pattern `InputCapabilityBanner.test.tsx` uses. */
const neverConnects = (): Promise<never> => new Promise(() => {})

afterEach(() => {
  cleanup()
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useThemeStore.setState({ theme: 'system' })
  document.documentElement.removeAttribute('data-theme')
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

  describe('Audio', () => {
    it('states the real current output in learner language', () => {
      render(<SettingsScreen onGoToToday={vi.fn()} connectMidi={neverConnects} />)

      expect(screen.getByText('Sound: built-in piano sounds')).toBeInTheDocument()
    })
  })
})
