/**
 * File import (REQ-3.2.5). Happy path and error path — a malformed file must
 * surface a readable message in the UI, never a console log or a crash.
 *
 * `.mxl` fixtures are built in-test with `fflate`'s `zipSync`, matching
 * `src/core/notation/mxl.test.ts` — no binary fixture file is committed.
 */
import singlePartMusicXml from '@core/notation/__fixtures__/single-part.musicxml?raw'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportPanel } from './ImportPanel.tsx'

const encoder = new TextEncoder()
const bytes = (s: string): Uint8Array => encoder.encode(s)

const containerXml = (fullPath: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="${fullPath}" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`

/**
 * Returned as an `ArrayBuffer`, not a `Uint8Array`: `fflate` types its output as
 * `Uint8Array<ArrayBufferLike>`, which is not a `BlobPart` under the DOM lib.
 */
function validMxlArchive(): ArrayBuffer {
  const zipped = zipSync({
    'META-INF/container.xml': bytes(containerXml('score.musicxml')),
    'score.musicxml': bytes(singlePartMusicXml),
  })
  const buffer = new ArrayBuffer(zipped.length)
  new Uint8Array(buffer).set(zipped)
  return buffer
}

function resetStore(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

function getFileInput(): HTMLInputElement {
  return screen.getByLabelText(/import a score/i) as HTMLInputElement
}

describe('ImportPanel', () => {
  it('loads a valid MusicXML file into the store', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    const file = new File([singlePartMusicXml], 'scale.musicxml', { type: 'application/xml' })

    await user.upload(getFileInput(), file)

    await waitFor(() => expect(useScoreStore.getState().loaded).toBeDefined())
    const loaded = useScoreStore.getState().loaded
    expect(loaded?.sourceName).toBe('scale.musicxml')
    expect(loaded?.musicXml).toBe(singlePartMusicXml)
    expect(loaded?.score.notes.length).toBeGreaterThan(0)
    expect(useScoreStore.getState().importError).toBeUndefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a readable error for a malformed MusicXML file, and does not load a score', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    const file = new File(['<score-partwise><unclosed'], 'broken.musicxml', {
      type: 'application/xml',
    })

    await user.upload(getFileInput(), file)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/broken\.musicxml/)
    expect(useScoreStore.getState().loaded).toBeUndefined()
    expect(useScoreStore.getState().importError).toBeDefined()
  })

  // UI-21 (states sweep): the parser's own `Err` text is a developer-facing
  // parse diagnostic (raw XML tag names, "unterminated <unclosed> tag") — the
  // learner-facing alert must say something a non-technical reader can act
  // on instead, and the recovery path (the same file input, still enabled) is
  // right there in the same dialog, not a dead end.
  it('shows learner-language copy, not the raw parser diagnostic, and the file input stays usable to retry', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    const file = new File(['this is not xml at all'], 'corrupt.musicxml', {
      type: 'application/xml',
    })

    await user.upload(getFileInput(), file)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/corrupt\.musicxml/)
    expect(alert.textContent).toMatch(/doesn't look like a valid score file/i)
    expect(alert.textContent).not.toMatch(/root element|<unclosed>|malformed MusicXML/)
    expect(getFileInput()).toBeEnabled()
  })

  it('shows a readable error for a malformed MIDI file', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'broken.mid', {
      type: 'audio/midi',
    })

    await user.upload(getFileInput(), file)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/broken\.mid/)
    expect(useScoreStore.getState().loaded).toBeUndefined()
  })

  it('unpacks and loads a valid .mxl file into the store, with real musicXml defined', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    const file = new File([validMxlArchive()], 'scale.mxl', { type: 'application/vnd.recordare.musicxml' })

    await user.upload(getFileInput(), file)

    await waitFor(() => expect(useScoreStore.getState().loaded).toBeDefined())
    const loaded = useScoreStore.getState().loaded
    expect(loaded?.sourceName).toBe('scale.mxl')
    // Mutant: `loadScore({ ..., musicXml: undefined })` for the `.mxl` branch —
    // the whole point of `.mxl` support is that OSMD CAN engrave it, unlike a
    // MIDI import. `musicXml` must be the unpacked MusicXML text, not absent.
    expect(loaded?.musicXml).toBe(singlePartMusicXml)
    expect(loaded?.score.notes.length).toBeGreaterThan(0)
    expect(useScoreStore.getState().importError).toBeUndefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a readable error when a .mxl file fails to unpack, and does not load a score', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    // Not a ZIP at all, so `unpackMxl` returns an `Err` — the unpack failure
    // must be reported the same readable way a parse failure is, never a
    // thrown exception or a silent no-op.
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'broken.mxl', {
      type: 'application/vnd.recordare.musicxml',
    })

    await user.upload(getFileInput(), file)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/broken\.mxl/)
    expect(useScoreStore.getState().loaded).toBeUndefined()
    expect(useScoreStore.getState().importError).toBeDefined()
  })

  it('rejects an unsupported file extension with a readable message', async () => {
    // `accept` is a UX hint, not a security boundary — a real browser lets a user
    // pick "All files" and bypass it, so the app's own check must still fire.
    // Bypass user-event's accept filtering here to exercise exactly that check.
    const user = userEvent.setup({ applyAccept: false })
    render(<ImportPanel />)
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    await user.upload(getFileInput(), file)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/notes\.txt/)
    expect(useScoreStore.getState().loaded).toBeUndefined()
  })
})
