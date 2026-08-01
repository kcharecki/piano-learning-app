/**
 * Fake Web MIDI harness for e2e (roadmap 2.11). The app has no MIDI
 * simulation of its own, so this installs a fake `navigator.requestMIDIAccess`
 * into the page before any app code runs — it MUST be wired with
 * `page.addInitScript`, before `page.goto`, so the fake exists the instant the
 * app's own MIDI connection effect fires on mount.
 *
 * It satisfies exactly what `src/adapters/midi/webmidi.ts` expects of a real
 * browser:
 *   - `requestMIDIAccess()` resolves to `{ inputs, outputs, onstatechange }`,
 *     with `inputs`/`outputs` as `Map`s (the adapter iterates `.values()`).
 *   - `inputs` holds ONE port with a stable `id`, `name`, `manufacturer`,
 *     `state: 'connected'`, and a settable `onmidimessage` — the adapter
 *     assigns that property directly (`port.onmidimessage = ...`) and gates
 *     every incoming message on `portId === selectedDeviceId`, which
 *     `src/app/practice/useMidiConnection.ts`'s auto-select (first device
 *     wins) sets to this port's `id` as soon as it appears in the store.
 *   - the event object handed to `onmidimessage` carries `data` (a
 *     `Uint8Array`) and `timeStamp` (a number on the `performance.now()`
 *     epoch — the same epoch `src/app/practice/clock.ts`'s
 *     `createBrowserClock` reads via `Clock.now()`).
 *
 * `window.__fakeMidi.schedule(...)` is the page-side surface a test drives
 * from Node with `page.evaluate`: it fires a whole list of note on/off events
 * against absolute `performance.now()` instants, DRIFT-CORRECTED — each event
 * wakes early via `setTimeout` (~`LEAD_MS` before its target) and then spins
 * on `performance.now()` until the target instant is actually reached. The
 * spin absorbs lateness as well as earliness (a `setTimeout` that wakes after
 * its target just runs `run()` immediately), which is what keeps jitter under
 * the matcher's 50ms "on time" window (`MATCHER_DEFAULTS.onTimeMs`, see
 * `src/core/practice/matcher.ts`) even when the main thread is busy.
 *
 * This fake covers the initial-attach path only (the port already present in
 * `inputs` when `requestMIDIAccess()` resolves, which drives
 * `useMidiConnection`'s auto-select): `onstatechange` is never fired, so
 * hot-plug / device-list-changed handling is not exercised.
 */
import type { Page } from '@playwright/test'

/** One note on/off to fire at an absolute `performance.now()` instant in the page. */
type FakeMidiEvent = {
  readonly type: 'on' | 'off'
  /** MIDI note number, 0..127. */
  readonly note: number
  /** Absolute `performance.now()` ms in the page — NOT a delay from now. */
  readonly atMs: number
}

type FakeMidiHandle = {
  /** Fires every event at its own instant; resolves once the last one has fired. */
  readonly schedule: (events: readonly FakeMidiEvent[]) => Promise<void>
}

/** One note on/off to fire at a `performance.now()` offset from an anchor taken later. */
export type RelativeFakeMidiEvent = {
  readonly type: 'on' | 'off'
  /** MIDI note number, 0..127. */
  readonly note: number
  /** Offset in ms from the anchor instant (the click). */
  readonly offsetMs: number
}

declare global {
  interface Window {
    __fakeMidi?: FakeMidiHandle
    __fakeMidiArmed?: Promise<void>
  }
}

/** The one fake input port — stable across the whole test so selection sticks. */
const FAKE_MIDI_DEVICE_ID = 'fake-midi-input-0'
export const FAKE_MIDI_DEVICE_NAME = 'Fake MIDI Test Keyboard'
const FAKE_MIDI_DEVICE_MANUFACTURER = 'Playwright Fixture'

/**
 * How long before an event's target instant the correcting spin-wait wakes
 * up. Must stay well under the schedule's minimum event gap (100ms in
 * assessment.spec.ts's schedule) so the spin for one event cannot run past
 * the next event's target.
 *
 * Passed INTO the init script as an argument, never closed over: an
 * `addInitScript` callback is serialised to source and evaluated in the page,
 * where this module's scope does not exist.
 */
const LEAD_MS = 50

/**
 * Install the fake `navigator.requestMIDIAccess` and `window.__fakeMidi`.
 * MUST be awaited before `page.goto` — `addInitScript` only affects
 * navigations that happen after it is registered.
 */
export async function installFakeMidi(page: Page): Promise<void> {
  await page.addInitScript(
    (device: { id: string; name: string; manufacturer: string; leadMs: number }) => {
      type OnMidiMessage = (event: { data: Uint8Array; timeStamp: number }) => void
      type FakePort = {
        id: string
        name: string
        manufacturer: string
        state: 'connected'
        onmidimessage: OnMidiMessage | null
      }

      const port: FakePort = {
        id: device.id,
        name: device.name,
        manufacturer: device.manufacturer,
        state: 'connected',
        onmidimessage: null,
      }

      const access = {
        inputs: new Map<string, FakePort>([[port.id, port]]),
        outputs: new Map<string, unknown>(),
        onstatechange: null as (() => void) | null,
      }

      // `navigator.requestMIDIAccess` does not exist on a headless browser
      // with no MIDI permission model wired up; defineProperty adds it rather
      // than assigning to a getter-only descriptor some environments install.
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.resolve(access),
      })

      const NOTE_ON_STATUS = 0x90
      const NOTE_OFF_STATUS = 0x80
      const VELOCITY = 96

      function fire(status: number, note: number, velocity: number): void {
        if (port.onmidimessage === null) return
        port.onmidimessage({
          data: new Uint8Array([status, note, velocity]),
          timeStamp: performance.now(),
        })
      }

      /** Drift-corrected: wake a few ms early, then spin to the exact instant. */
      function fireAt(atMs: number, run: () => void): Promise<void> {
        return new Promise((resolve) => {
          const delay = Math.max(0, atMs - performance.now() - device.leadMs)
          setTimeout(() => {
            while (performance.now() < atMs) {
              // Busy-wait the last few ms — see the module doc on drift correction.
            }
            run()
            resolve()
          }, delay)
        })
      }

      window.__fakeMidi = {
        schedule(events: readonly FakeMidiEvent[]): Promise<void> {
          return Promise.all(
            events.map((event) =>
              fireAt(event.atMs, () =>
                fire(
                  event.type === 'on' ? NOTE_ON_STATUS : NOTE_OFF_STATUS,
                  event.note,
                  event.type === 'on' ? VELOCITY : 0,
                ),
              ),
            ),
          ).then(() => undefined)
        },
      }
    },
    {
      id: FAKE_MIDI_DEVICE_ID,
      name: FAKE_MIDI_DEVICE_NAME,
      manufacturer: FAKE_MIDI_DEVICE_MANUFACTURER,
      leadMs: LEAD_MS,
    },
  )
}

/**
 * Registers a capture-phase click listener on the button whose visible text
 * is `buttonText`: in the SAME synchronous browser turn as the click, it
 * takes `performance.now()` as the anchor and immediately arms
 * `window.__fakeMidi.schedule()` with absolute instants derived from
 * `events`' offsets — no Node<->CDP round trip between anchor and schedule,
 * so event k=0 cannot already be in the past when it fires. Capture phase
 * runs before React's (bubble-phase) onClick, so the anchor is taken before
 * `useAssessment.start()` reads the clock too.
 *
 * Call this BEFORE the real, trusted Playwright click on the same button;
 * await `waitForArmedFakeMidiSchedule` after the click to know every event
 * has fired.
 */
export async function armFakeMidiOnClick(
  page: Page,
  buttonText: string,
  events: readonly RelativeFakeMidiEvent[],
): Promise<void> {
  await page.evaluate(
    ({ text, evts }) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === text,
      )
      if (button === undefined) throw new Error(`button "${text}" not found`)
      const handler = (): void => {
        const anchor = performance.now()
        const fakeMidi = window.__fakeMidi
        if (fakeMidi === undefined) return
        window.__fakeMidiArmed = fakeMidi.schedule(
          evts.map((e) => ({ type: e.type, note: e.note, atMs: anchor + e.offsetMs })),
        )
      }
      button.addEventListener('click', handler, { capture: true, once: true })
    },
    { text: buttonText, evts: events },
  )
}

/** Waits for the schedule armed by `armFakeMidiOnClick` to finish firing. */
export async function waitForArmedFakeMidiSchedule(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (window.__fakeMidiArmed === undefined) {
      throw new Error('no armed schedule — call armFakeMidiOnClick before the click')
    }
    await window.__fakeMidiArmed
  })
}
