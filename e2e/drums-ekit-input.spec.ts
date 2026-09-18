import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap DR-02 (app slice): a real e-drum kit, talking Web
 * MIDI, reaches a drum trainer as a real hit — not just the on-screen pads
 * and QWERTY keys the trainers already accept.
 *
 * `useDrumMidiInput.test.ts` proves the join (kit-map engine -> `onHit`,
 * debounce, choke filtering, the unmapped bucket, unmount teardown) against a
 * `FakeMidiInput` with no browser at all; what only a real browser run can
 * show is that a `navigator.requestMIDIAccess` port, wired the way
 * `src/adapters/midi/webmidi.ts` expects one, actually reaches the Groove
 * trainer's own status line and its "Last hit" readout through the whole
 * stack: Web MIDI adapter -> `useMidiConnection` -> `useDrumMidiInput` ->
 * screen.
 */

type FakeMidiMessageEvent = { readonly data: Uint8Array; readonly timeStamp: number }
type FakePort = {
  id: string
  name: string
  manufacturer: string
  state: string
  connection: string
  type: string
  onmidimessage: ((event: FakeMidiMessageEvent) => void) | null
}

declare global {
  interface Window {
    __fakeEkitPort?: FakePort
  }
}

/**
 * Installs a fake `navigator.requestMIDIAccess` resolving to one connected
 * input port, and stashes that port on `window.__fakeEkitPort` so the spec
 * can drive `onmidimessage` later from `page.evaluate`. MUST run before
 * `page.goto` — `addInitScript` only affects navigations registered after it.
 */
async function installFakeEkit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type OnMidiMessage = (event: { data: Uint8Array; timeStamp: number }) => void
    type Port = {
      id: string
      name: string
      manufacturer: string
      state: string
      connection: string
      type: string
      onmidimessage: OnMidiMessage | null
    }

    const port: Port = {
      id: 'ekit-1',
      name: 'Fake TD-17',
      manufacturer: 'Roland',
      state: 'connected',
      connection: 'open',
      type: 'input',
      onmidimessage: null,
    }

    const access = {
      inputs: new Map<string, Port>([[port.id, port]]),
      outputs: new Map<string, unknown>(),
      onstatechange: null as (() => void) | null,
      sysexEnabled: false,
    }

    // `navigator.requestMIDIAccess` does not exist on a headless browser with
    // no MIDI permission model — defineProperty adds it rather than assigning
    // to a getter-only descriptor some environments install (see fake-midi.ts).
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
    })

    window.__fakeEkitPort = port
  })
}

/** Dispatches one raw MIDI message on the fake port, as the real e-kit would. */
async function sendEkitMessage(page: Page, data: readonly number[]): Promise<void> {
  await page.evaluate((bytes) => {
    const port = window.__fakeEkitPort
    if (port === undefined) throw new Error('drums-ekit-input: fake e-kit port was not installed')
    port.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() })
  }, data)
}

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function runState(page: Page) {
  return page.getByRole('status', { name: 'Run state' })
}

function ekitStatus(page: Page) {
  return page.getByRole('status', { name: 'E-kit' })
}

function lastHitStatus(page: Page) {
  return page.getByRole('status', { name: 'Last hit' })
}

// @serial — runs a real count-in in real time, the same reason
// `drums-groove-loop.spec.ts` and `drums-groove-live-feedback.spec.ts` are.
test('a real e-kit stroke over Web MIDI reaches the Groove trainer as a graded hit (roadmap DR-02) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await installFakeEkit(page)

  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()

  // The e-kit connected and mapped itself with the General MIDI preset —
  // proof the whole chain (fake Web MIDI port -> adapter -> useMidiConnection
  // -> useDrumMidiInput) reached the screen before a single note was struck.
  await expect(ekitStatus(page)).toHaveText('E-kit: Fake TD-17 · General MIDI map')

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(runState(page)).toContainText('Playing', { timeout: 10_000 })

  // GM note 38, channel 10 (0x99) = acoustic snare.
  await sendEkitMessage(page, [0x99, 38, 100])
  await expect(lastHitStatus(page)).toContainText('Snare', { timeout: 5_000 })

  // Note 61 is not in the General MIDI kit map — it must surface as an
  // unmapped note on the status line, not silently vanish or crash the run.
  await sendEkitMessage(page, [0x99, 61, 100])
  await expect(ekitStatus(page)).toContainText('note 61, which is not in the map')

  expect(consoleErrors).toEqual([])
})
