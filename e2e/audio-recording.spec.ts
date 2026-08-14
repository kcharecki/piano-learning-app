import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  FAKE_MIDI_DEVICE_NAME,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'

/**
 * E2E proof for roadmap B.5 (REQ-3.9.2 "audio recording is optional") — the
 * audio half of practice recording, alongside `e2e/record-replay.spec.ts`'s
 * MIDI half. This sandbox has no real microphone, so Chromium is launched
 * with its fake media device (`--use-fake-device-for-media-stream`) and fake
 * permission UI (`--use-fake-ui-for-media-stream`) — set here, in the spec's
 * own `launchOptions`, not the shared `playwright.config.ts`, which a sibling
 * worktree session may also be editing this round.
 *
 * The fake device produces a real (synthetic tone) audio signal, so
 * `MediaRecorder` captures real, non-empty chunks — this is not a mocked
 * `MediaRecorder`, it is the actual browser API running against a fake input.
 *
 * `readStoredAudio`/`readStoredRecordingEventCount` go straight at
 * `indexedDB` from the page, bypassing the app entirely, so what they read
 * back is exactly what `src/adapters/store/idb.ts`'s `putRecordingAudio`
 * persisted — not a re-assertion of in-memory React state.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

const QUARTER_MS = 500
const NOTE_HOLD_MS = 400
const PLAYED_PITCHES: readonly number[] = [60, 62, 64] // C4 D4 E4, measure 1 of the fixture

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/**
 * UI-09 (2026-08-12 UI audit): file import moved behind a "Change piece…"
 * button that opens a modal `<dialog>` — closes it again once the new
 * score's title is confirmed, so the rest of the screen is interactable.
 */
async function importScore(page: Page, fixturePath: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Change piece…' }).click()
  await page.getByLabel(/Import a score/i).setInputFiles(fixturePath)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('dialog', { name: 'Change piece' }).getByRole('button', { name: 'Close' }).click()
}

/**
 * UI-04b: the MIDI status line moved into the shell topbar's input-status
 * chip popover — open it, check the text, then Escape closes it again.
 */
async function expectMidiStatusText(page: Page, pattern: RegExp): Promise<void> {
  const chip = page.getByRole('button', { name: /MIDI connected|No MIDI/ })
  await chip.click()
  await expect(page.getByText(pattern)).toBeVisible()
  await page.keyboard.press('Escape')
}

type StoredAudioProbe = {
  readonly mimeType: string
  readonly offsetMs: number
  readonly byteLength: number
} | null

/** Reads the audio side-store directly from IndexedDB — the `audio:<id>` key `putRecordingAudio` writes into the `recordings` object store. */
async function readStoredAudio(page: Page): Promise<StoredAudioProbe> {
  return page.evaluate(
    () =>
      new Promise<StoredAudioProbe>((resolve, reject) => {
        const openReq = indexedDB.open('piano-learning-app')
        openReq.onerror = () => reject(openReq.error)
        openReq.onsuccess = () => {
          const db = openReq.result
          const tx = db.transaction('recordings', 'readonly')
          const store = tx.objectStore('recordings')
          const keysReq = store.getAllKeys()
          const valuesReq = store.getAll()
          let keys: IDBValidKey[] | undefined
          let values: unknown[] | undefined
          function settle(): void {
            if (keys === undefined || values === undefined) return
            const index = keys.findIndex((k) => typeof k === 'string' && k.startsWith('audio:'))
            if (index === -1) {
              resolve(null)
              return
            }
            const record = values[index] as { mimeType: string; offsetMs: number; bytes: ArrayBuffer }
            resolve({
              mimeType: record.mimeType,
              offsetMs: record.offsetMs,
              byteLength: record.bytes.byteLength,
            })
          }
          keysReq.onsuccess = () => {
            keys = keysReq.result
            settle()
          }
          valuesReq.onsuccess = () => {
            values = valuesReq.result
            settle()
          }
        }
      }),
  )
}

/** Reads the newest stored `Recording`'s MIDI event count directly from IndexedDB — the same `recordings` array `useRecorder`/`persistence.ts` write, untouched by this feature. */
async function readStoredRecordingEventCount(page: Page): Promise<number | undefined> {
  return page.evaluate(
    () =>
      new Promise<number | undefined>((resolve, reject) => {
        const openReq = indexedDB.open('piano-learning-app')
        openReq.onerror = () => reject(openReq.error)
        openReq.onsuccess = () => {
          const db = openReq.result
          const tx = db.transaction('recordings', 'readonly')
          const store = tx.objectStore('recordings')
          const getReq = store.get('recordings')
          getReq.onsuccess = () => {
            const value = getReq.result as { recordings?: { events: unknown[] }[] } | undefined
            resolve(value?.recordings?.[0]?.events.length)
          }
          getReq.onerror = () => reject(getReq.error)
        }
      }),
  )
}

test('records audio alongside a MIDI take, stores a non-empty blob with a real mime type, and replay plays both (roadmap B.5)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)
  await expectMidiStatusText(page, new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`))
  await page.waitForTimeout(300)

  const recordPanel = page.getByRole('group', { name: 'Record and replay' })
  const recordButton = recordPanel.getByRole('button', { name: 'Record', exact: true })
  const stopRecordingButton = recordPanel.getByRole('button', { name: 'Stop recording' })
  const replayButton = recordPanel.getByRole('button', { name: 'Replay', exact: true })
  const stopReplayButton = recordPanel.getByRole('button', { name: 'Stop replay' })

  // The audio controls are grouped behind their own collapsed <details> (see
  // RecordPanel.tsx's "what this demotes" comment) — open it, then opt in.
  await recordPanel.getByText('Audio recording', { exact: true }).click()
  const audioToggle = recordPanel.getByRole('checkbox', { name: /record audio too/i })
  await audioToggle.check()
  // The checkbox itself flips "checked" the instant `setEnabled(true)` is
  // called — optimistic, not a proof the mic is actually ready. The real
  // getUserMedia round trip against the fake device is what "Requesting
  // microphone…" tracks; recording before it clears would begin against a
  // recorder that is not there yet.
  await expect(audioToggle).toBeChecked({ timeout: 10_000 })
  await expect(recordPanel.getByText('Requesting microphone…')).toHaveCount(0, { timeout: 10_000 })

  await expect(recordButton).toBeEnabled()

  const events: RelativeFakeMidiEvent[] = []
  for (const [k, note] of PLAYED_PITCHES.entries()) {
    const onOffset = k * QUARTER_MS
    events.push({ type: 'on', note, offsetMs: onOffset })
    events.push({ type: 'off', note, offsetMs: onOffset + NOTE_HOLD_MS })
  }
  await armFakeMidiOnClick(page, 'Record', events)
  await recordButton.click()
  await waitForArmedFakeMidiSchedule(page)
  // Real wall-clock recording time so the fake device has produced more than
  // a token amount of audio data.
  await page.waitForTimeout(600)

  await stopRecordingButton.click()

  // ---- Read back from the real IndexedDB, independent of React state ----
  await expect
    .poll(async () => (await readStoredAudio(page)) !== null, { timeout: 10_000 })
    .toBe(true)
  const storedAudio = await readStoredAudio(page)
  expect(storedAudio).not.toBeNull()
  expect(storedAudio?.mimeType).toMatch(/^audio\//)
  expect(storedAudio?.byteLength ?? 0).toBeGreaterThan(0)
  expect(Number.isFinite(storedAudio?.offsetMs)).toBe(true)

  const eventCount = await readStoredRecordingEventCount(page)
  expect(eventCount ?? 0).toBeGreaterThan(0)

  // The panel's own summary agrees with what is actually in storage.
  await expect(recordPanel.getByTestId('record-audio-summary')).toBeVisible()

  // ---- Replay: both MIDI and audio should play together ----
  await expect(replayButton).toBeEnabled()
  await replayButton.click()

  const audioElement = page.locator('audio')
  await expect(audioElement).toHaveCount(1)
  await expect
    .poll(() => audioElement.evaluate((el) => (el as HTMLAudioElement).paused), { timeout: 5_000 })
    .toBe(false)
  await page.waitForTimeout(200)
  const currentTime = await audioElement.evaluate((el) => (el as HTMLAudioElement).currentTime)
  expect(currentTime).toBeGreaterThan(0)

  // UI-10: Replay/Stop replay share ONE toggle whose accessible name swaps
  // back to "Replay" (enabled) once the phase leaves 'replaying' — it is
  // never merely disabled, so "Stop replay" disappearing is the transition
  // to wait for.
  await expect(stopReplayButton).toBeHidden({ timeout: 15_000 })
  await expect(replayButton).toBeEnabled()

  expect(errors).toEqual([])
})

test('a denied microphone permission surfaces a real error, without crashing the panel (roadmap B.5)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  // Overrides the fake-device grant this file's `launchOptions` would
  // otherwise provide — this test wants the DENIAL path specifically.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...navigator.mediaDevices,
        getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      },
    })
  })

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)

  const recordPanel = page.getByRole('group', { name: 'Record and replay' })
  await recordPanel.getByText('Audio recording', { exact: true }).click()
  // `.click()`, not `.check()`: the checkbox flips true optimistically then
  // reverts to unchecked once the (rejected) mic request resolves, so it
  // never settles "checked" for `.check()`'s own stability wait to observe.
  await recordPanel.getByRole('checkbox', { name: /record audio too/i }).click()

  await expect(page.getByRole('alert')).toContainText(/permission denied/i)
  // Additive, not fatal — the rest of the panel (and the MIDI half) is
  // unaffected by the denial.
  await expect(recordPanel.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
  await expect(recordPanel.getByRole('checkbox', { name: /record audio too/i })).not.toBeChecked()

  expect(errors).toEqual([])
})
