import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeMidiInput } from '@test/fakes.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputCapabilityBanner } from './InputCapabilityBanner.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * A minimal fake `navigator.bluetooth` sufficient for the real
 * `connectBluetoothMidi` adapter — same helper `MidiDeviceStatus.test.tsx`
 * uses, so the "Pair Bluetooth MIDI" button (only rendered when Web
 * Bluetooth is supported) actually appears.
 */
function stubBluetoothNavigator(): void {
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: () => new Promise(() => {}) } })
}

describe('InputCapabilityBanner', () => {
  it('renders as a chip saying no MIDI is connected when nothing is plugged in', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<InputCapabilityBanner connectMidi={neverResolves} />)

    expect(screen.getByRole('button', { name: /no midi — using on-screen keys/i })).toBeInTheDocument()
  })

  it('renders as a chip saying MIDI is connected once a device is selected', () => {
    render(<InputCapabilityBanner midiInput={new FakeMidiInput()} />)

    expect(screen.getByRole('button', { name: 'MIDI connected' })).toBeInTheDocument()
  })

  it('the popover is not in the document until the chip is opened', () => {
    render(<InputCapabilityBanner midiInput={new FakeMidiInput()} />)
    expect(screen.queryByText(/pair bluetooth midi/i)).not.toBeInTheDocument()
  })

  it('opens the popover on click, with the correct aria contract', async () => {
    const user = userEvent.setup()
    render(<InputCapabilityBanner midiInput={new FakeMidiInput()} />)

    const chip = screen.getByRole('button', { name: 'MIDI connected' })
    expect(chip).toHaveAttribute('aria-expanded', 'false')

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/keyboard connected: fake digital piano/i)).toBeInTheDocument()
  })

  it('opens the popover on Enter, keyboard reachable via Tab', async () => {
    const user = userEvent.setup()
    render(<InputCapabilityBanner midiInput={new FakeMidiInput()} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'MIDI connected' })).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'MIDI connected' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('closes on Escape and returns focus to the chip', async () => {
    const user = userEvent.setup()
    render(<InputCapabilityBanner midiInput={new FakeMidiInput()} />)

    const chip = screen.getByRole('button', { name: 'MIDI connected' })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')

    expect(chip).toHaveAttribute('aria-expanded', 'false')
    expect(chip).toHaveFocus()
  })

  it('closes on an outside click', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <InputCapabilityBanner midiInput={new FakeMidiInput()} />
        <button type="button">Elsewhere</button>
      </div>,
    )

    const chip = screen.getByRole('button', { name: 'MIDI connected' })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))

    expect(chip).toHaveAttribute('aria-expanded', 'false')
  })

  it('the popover contains the Bluetooth pairing action', async () => {
    stubBluetoothNavigator()
    const user = userEvent.setup()
    render(<InputCapabilityBanner connectMidi={() => new Promise(() => {})} />)

    await user.click(screen.getByRole('button', { name: /no midi/i }))

    expect(screen.getByRole('button', { name: /pair bluetooth midi/i })).toBeInTheDocument()
  })

  it('the popover points to the microphone as an alternative', async () => {
    const user = userEvent.setup()
    render(<InputCapabilityBanner connectMidi={() => new Promise(() => {})} />)

    await user.click(screen.getByRole('button', { name: /no midi/i }))

    expect(screen.getByText(/try the microphone on practice/i)).toBeInTheDocument()
  })

  // Roadmap 5.6/B.7: the browser has no Web MIDI at all — a different, more
  // fundamental fact than "nothing is plugged in yet" (the tests above),
  // and it must stay reachable and worded distinctly from that case.
  describe('when Web MIDI is unsupported', () => {
    it('names the limitation in the popover, distinct from "nothing connected yet"', async () => {
      const user = userEvent.setup()
      render(<InputCapabilityBanner supported={false} connectMidi={() => new Promise(() => {})} />)

      await user.click(screen.getByRole('button', { name: /no midi/i }))

      expect(screen.getByText(/this browser can't connect a midi keyboard/i)).toBeInTheDocument()
      // The generic "No MIDI keyboard connected" line would just repeat the
      // same fact in different words — MidiDeviceStatus's own USB line is
      // suppressed in this case (see its `hideUsbStatus` prop).
      expect(screen.queryByText(/^no midi keyboard connected/i)).not.toBeInTheDocument()
    })

    it('still offers Bluetooth pairing as the workaround', async () => {
      stubBluetoothNavigator()
      const user = userEvent.setup()
      render(<InputCapabilityBanner supported={false} connectMidi={() => new Promise(() => {})} />)

      await user.click(screen.getByRole('button', { name: /no midi/i }))

      expect(screen.getByRole('button', { name: /pair bluetooth midi/i })).toBeInTheDocument()
    })
  })
})
