import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap B.2 (REQ-3.3.1): Bluetooth LE MIDI as a second,
 * explicit-gesture input path alongside Web MIDI.
 *
 * Headless Chromium exposes no real BLE radio, so both halves of the claim
 * are proven honestly, separately:
 *
 *  1. With `navigator.bluetooth` stubbed ABSENT (the real state of Safari and
 *     Firefox — neither ships Web Bluetooth in any shell), the control names
 *     the limitation and the app does not crash.
 *  2. With `navigator.bluetooth` stubbed to a FAKE device whose GATT
 *     characteristic accepts real BLE-MIDI packet BYTES (the exact wire
 *     format `src/core/midi/bleMidiPacket.ts` decodes — header byte,
 *     timestamp byte, running status), driving those bytes through the
 *     `characteristicvaluechanged` listener the app itself registered proves
 *     the note reaches the real matcher: `feedback-correct` moves, which can
 *     only happen through `core/practice/matcher.ts` grading a real
 *     `MidiEvent`, not a UI-only stub.
 *
 * No physical BLE MIDI keyboard was available to record this against — every
 * claim below rests on the fake device, never on real hardware.
 */

/** The pitches sounding at tick 0 of the bundled sample (see e2e/waitmode.spec.ts, practice-onscreen-keyboard.spec.ts). */
const FIRST_BEAT_PITCHES = [48, 52, 55, 60] as const

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Removes Web Bluetooth from the page — the real state of Safari and Firefox. */
async function removeWebBluetooth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'bluetooth')
    Reflect.deleteProperty(navigator, 'bluetooth')
  })
}

declare global {
  interface Window {
    __bleMidi?: { notify: (bytes: number[]) => void }
  }
}

/**
 * Installs a fake `navigator.bluetooth.requestDevice` that resolves — as if
 * the learner had just picked a device from the real browser chooser — to a
 * device whose GATT server/service/characteristic satisfy exactly what
 * `src/adapters/midi/blemidi.ts` calls: `gatt.connect()`,
 * `getPrimaryService(BLE_MIDI_SERVICE)`, `getCharacteristic(BLE_MIDI_CHARACTERISTIC)`,
 * `startNotifications()`, `addEventListener('characteristicvaluechanged', ...)`.
 * `window.__bleMidi.notify(bytes)` is the Node-side hand on the wire: it fires
 * that listener with a real `DataView` over the given bytes, exactly as a
 * GATT notification would.
 */
async function installFakeBluetoothMidi(page: Page, deviceName: string): Promise<void> {
  await page.addInitScript((name: string) => {
    const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
    const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3'

    type ValueChangedListener = (event: { target: { value: DataView } }) => void
    const listeners = new Set<ValueChangedListener>()

    const characteristic = {
      startNotifications: () => Promise.resolve(characteristic),
      stopNotifications: () => Promise.resolve(characteristic),
      addEventListener: (_type: string, listener: ValueChangedListener) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: ValueChangedListener) => {
        listeners.delete(listener)
      },
    }
    const service = {
      getCharacteristic: (uuid: string) =>
        uuid === BLE_MIDI_CHARACTERISTIC ? Promise.resolve(characteristic) : Promise.reject(new Error('no such characteristic')),
    }
    const gatt = {
      connected: true,
      connect: () => Promise.resolve(gatt),
      disconnect: () => {
        gatt.connected = false
      },
      getPrimaryService: (uuid: string) =>
        uuid === BLE_MIDI_SERVICE ? Promise.resolve(service) : Promise.reject(new Error('no such service')),
    }
    const device = {
      name,
      gatt,
      addEventListener: () => {},
      removeEventListener: () => {},
    }

    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: { requestDevice: () => Promise.resolve(device) },
    })

    window.__bleMidi = {
      notify(bytes: number[]): void {
        const value = new DataView(Uint8Array.from(bytes).buffer)
        for (const listener of listeners) listener({ target: { value } })
      },
    }
  }, deviceName)
}

async function openPractice(page: Page): Promise<void> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()
}

test('with navigator.bluetooth absent, the control states the limitation and does not crash', async ({ page }) => {
  const errors = collectErrors(page)

  await removeWebBluetooth(page)
  await openPractice(page)

  await expect(page.getByText(/bluetooth midi is not available in this browser/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /pair bluetooth midi/i })).toBeHidden()

  expect(errors).toEqual([])
})

test('pairing a fake BLE MIDI device and playing a chord through it grades the notes via the real matcher', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await installFakeBluetoothMidi(page, 'E2E Fake BLE Keyboard')
  await openPractice(page)

  await page.getByRole('button', { name: /pair bluetooth midi/i }).click()
  await expect(page.getByText(/bluetooth midi connected: e2e fake ble keyboard/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /pair bluetooth midi/i })).toBeHidden()

  const correct = page.getByTestId('feedback-correct')
  const accuracy = page.getByTestId('feedback-accuracy')
  await expect(correct).toHaveText('0')

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  // Real BLE-MIDI packet bytes for the sample's first-beat chord, encoded
  // exactly per `src/core/midi/bleMidiPacket.ts`'s documented wire format:
  // header(ts-high=0), ts(low=0), status note-on ch0 + first note, then three
  // more notes via running status (no repeated status byte), all sharing the
  // same device timestamp — a chord struck at once.
  await page.evaluate(
    (pitches: readonly number[]) => {
      const bytes: number[] = [0x80, 0x80, 0x90, pitches[0] as number, 100]
      for (const pitch of pitches.slice(1)) bytes.push(0x80, pitch, 100)
      window.__bleMidi?.notify(bytes)
    },
    FIRST_BEAT_PITCHES,
  )

  // Graded by `core/practice/matcher.ts`, through the exact seam a USB
  // keyboard feeds — a screen that merely displayed "connected" would leave
  // this at zero forever, which is the defect this proof exists to rule out.
  await expect(async () => {
    expect(Number(await correct.textContent())).toBeGreaterThan(0)
  }).toPass({ timeout: 10_000 })
  await expect(accuracy).not.toHaveText('0%')

  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
  expect(errors).toEqual([])
})

test('Disconnect returns to the pairing control, and a note fired afterwards is not graded', async ({ page }) => {
  const errors = collectErrors(page)

  await installFakeBluetoothMidi(page, 'E2E Fake BLE Keyboard')
  await openPractice(page)
  await page.getByRole('button', { name: /pair bluetooth midi/i }).click()
  await expect(page.getByText(/bluetooth midi connected/i)).toBeVisible()

  await page.getByRole('button', { name: /disconnect/i }).click()

  await expect(page.getByRole('button', { name: /pair bluetooth midi/i })).toBeVisible()
  expect(errors).toEqual([])
})
