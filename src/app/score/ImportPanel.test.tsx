/**
 * File import (REQ-3.2.5). Happy path and error path — a malformed file must
 * surface a readable message in the UI, never a console log or a crash.
 */
import singlePartMusicXml from '@core/notation/__fixtures__/single-part.musicxml?raw'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportPanel } from './ImportPanel.tsx'

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
