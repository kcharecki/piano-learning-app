import type { MidiDevice } from '@core/ports/index.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MidiDeviceStatus } from './MidiDeviceStatus.tsx'
import { resetBluetoothMidiForTests } from './useBluetoothMidi.ts'

// `useBluetoothMidi`'s pairing now lives in module scope (it must outlive a
// component's mount — see that file's module comment), so it otherwise
// leaks a pairing from one test into the next within this file.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetBluetoothMidiForTests()
})

const DEVICE: MidiDevice = { id: 'a', name: 'Keyboard A', manufacturer: 'Test' }

/**
 * Since roadmap B.2, `MidiDeviceStatus` also renders its own Bluetooth status
 * line (`role="status"` too, "Bluetooth MIDI is not available..." in this
 * unstubbed happy-dom environment) — so these USB-status assertions scope to
 * the `.midi-status` element specifically rather than `getByRole('status')`,
 * which would now match two elements.
 */
function usbStatus(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.midi-status')
  if (el === null) throw new Error('.midi-status not found')
  return el as HTMLElement
}

describe('MidiDeviceStatus', () => {
  it('shows the graceful "no MIDI keyboard connected" state when nothing is connected', () => {
    const { container } = render(
      <MidiDeviceStatus
        connected={false}
        devices={[]}
        selectedDeviceId={null}
        connectionError={undefined}
      />,
    )
    expect(usbStatus(container)).toHaveTextContent(/no MIDI keyboard connected/i)
  })

  it('shows the same graceful state when connected but nothing is selected yet', () => {
    const { container } = render(
      <MidiDeviceStatus
        connected
        devices={[DEVICE]}
        selectedDeviceId={null}
        connectionError={undefined}
      />,
    )
    expect(usbStatus(container)).toHaveTextContent(/no MIDI keyboard connected/i)
  })

  it('names the connected device once one is selected', () => {
    const { container } = render(
      <MidiDeviceStatus
        connected
        devices={[DEVICE]}
        selectedDeviceId="a"
        connectionError={undefined}
      />,
    )
    expect(usbStatus(container)).toHaveTextContent('Keyboard A')
  })

  it('surfaces a connection error alongside the graceful state', () => {
    const { container } = render(
      <MidiDeviceStatus
        connected={false}
        devices={[]}
        selectedDeviceId={null}
        connectionError="Web MIDI API is not available in this browser."
      />,
    )
    expect(usbStatus(container)).toHaveTextContent(
      'Web MIDI API is not available in this browser.',
    )
  })

  // UI audit finding: `createWebMidi` used to surface the browser's own
  // exception text here (e.g. "MIDI access request failed: Permission to
  // use Web MIDI API was not granted."). It now returns learner copy for
  // that case — this component just has to keep passing it through as-is.
  it('surfaces the learner-safe permission-refused copy exactly as given, never a raw browser exception', () => {
    const { container } = render(
      <MidiDeviceStatus
        connected={false}
        devices={[]}
        selectedDeviceId={null}
        connectionError="This browser blocked MIDI access. Allow it in the browser's site settings, then reload the page."
      />,
    )
    expect(usbStatus(container)).toHaveTextContent(
      "This browser blocked MIDI access. Allow it in the browser's site settings, then reload the page.",
    )
    expect(usbStatus(container)).not.toHaveTextContent(/permission to use web midi api was not granted/i)
  })

  // Roadmap UI-04b: the shell's input-status popover already says "this
  // browser can't connect a MIDI keyboard" once, in its own words, before
  // rendering this component for the Bluetooth control underneath — this
  // proves the USB line can be suppressed instead of repeating that fact.
  it('omits the USB status line when hideUsbStatus is set, but keeps Bluetooth pairing', () => {
    const { container } = render(
      <MidiDeviceStatus
        connected={false}
        devices={[]}
        selectedDeviceId={null}
        connectionError={undefined}
        hideUsbStatus
      />,
    )
    expect(container.querySelector('.midi-status')).toBeNull()
    expect(screen.getByText(/bluetooth midi is not available in this browser/i)).toBeInTheDocument()
  })

  it('defaults to showing the USB status line (hideUsbStatus off)', () => {
    const { container } = render(
      <MidiDeviceStatus connected={false} devices={[]} selectedDeviceId={null} connectionError={undefined} />,
    )
    expect(usbStatus(container)).toHaveTextContent(/no MIDI keyboard connected/i)
  })
})

/** A minimal fake `navigator.bluetooth` sufficient for the real `connectBluetoothMidi` adapter. */
function stubBluetoothNavigator(): void {
  const characteristic = {
    startNotifications: () => Promise.resolve(),
    stopNotifications: () => Promise.resolve(),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const service = { getCharacteristic: () => Promise.resolve(characteristic) }
  const gatt = {
    connected: true,
    connect: () => Promise.resolve(gatt),
    disconnect: () => {},
    getPrimaryService: () => Promise.resolve(service),
  }
  const device = {
    name: 'Fake BLE Keyboard',
    gatt,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: () => Promise.resolve(device) } })
}

describe('MidiDeviceStatus — Bluetooth MIDI pairing (roadmap B.2)', () => {
  it('states the limitation, not a crash, when Web Bluetooth is unsupported — no pairing control offered', () => {
    render(<MidiDeviceStatus connected={false} devices={[]} selectedDeviceId={null} connectionError={undefined} />)

    expect(screen.getByText(/bluetooth midi is not available in this browser/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pair bluetooth midi/i })).not.toBeInTheDocument()
  })

  it('shows a "Pair Bluetooth MIDI" button when supported, and names the device once paired', async () => {
    stubBluetoothNavigator()
    render(<MidiDeviceStatus connected={false} devices={[]} selectedDeviceId={null} connectionError={undefined} />)
    const button = screen.getByRole('button', { name: /pair bluetooth midi/i })

    fireEvent.click(button)

    await waitFor(() =>
      expect(screen.getByText(/bluetooth midi connected: fake ble keyboard/i)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /pair bluetooth midi/i })).not.toBeInTheDocument()
  })

  it('Disconnect returns to the "Pair Bluetooth MIDI" button', async () => {
    stubBluetoothNavigator()
    render(<MidiDeviceStatus connected={false} devices={[]} selectedDeviceId={null} connectionError={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /pair bluetooth midi/i }))
    await waitFor(() => expect(screen.getByText(/bluetooth midi connected/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pair bluetooth midi/i })).toBeInTheDocument(),
    )
  })
})
