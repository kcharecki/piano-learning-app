/**
 * `ScoreViewer` drives OSMD through the `ScoreEngraver` seam, and OSMD does
 * not run in happy-dom — so every test here drives the component with a fake
 * engraver and asserts on the wiring, never on OSMD's own behaviour.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScoreEngraver } from './engraver.ts'
import { ScoreViewer, type ScoreViewerHandle } from './ScoreViewer.tsx'

function makeTestScore(): Score {
  return makeScore({
    id: 'viewer-test',
    measures: [{}],
    notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
  })
}

type FakeEngraver = ScoreEngraver & {
  readonly load: ReturnType<typeof vi.fn>
  readonly moveCursorTo: ReturnType<typeof vi.fn>
  readonly setNoteColor: ReturnType<typeof vi.fn>
  readonly clearNoteColors: ReturnType<typeof vi.fn>
  readonly setNoteHidden: ReturnType<typeof vi.fn>
  readonly clearHiddenNotes: ReturnType<typeof vi.fn>
  readonly destroy: ReturnType<typeof vi.fn>
}

function createFakeEngraver(loadResult: Promise<void> = Promise.resolve()): FakeEngraver {
  return {
    load: vi.fn(() => loadResult),
    moveCursorTo: vi.fn(),
    setNoteColor: vi.fn(),
    clearNoteColors: vi.fn(),
    setNoteHidden: vi.fn(),
    clearHiddenNotes: vi.fn(),
    destroy: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
})

describe('ScoreViewer', () => {
  it('passes the MusicXML and score through to the engraver on load', async () => {
    const engraver = createFakeEngraver()
    const score = makeTestScore()
    render(<ScoreViewer musicXml="<xml/>" score={score} createEngraver={() => engraver} />)

    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))
    const [container, musicXml, passedScore] = engraver.load.mock.calls[0] as [
      HTMLElement,
      string,
      Score,
    ]
    expect(container).toBeInstanceOf(HTMLElement)
    expect(musicXml).toBe('<xml/>')
    expect(passedScore).toBe(score)
  })

  it('moves the cursor to the right measure and tick when the position prop changes', async () => {
    const engraver = createFakeEngraver()
    const score = makeTestScore()
    const { rerender } = render(
      <ScoreViewer
        musicXml="<xml/>"
        score={score}
        cursorPosition={{ measureIndex: 0, tick: 0 }}
        createEngraver={() => engraver}
      />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))
    expect(engraver.moveCursorTo).toHaveBeenCalledWith(0, 0)

    rerender(
      <ScoreViewer
        musicXml="<xml/>"
        score={score}
        cursorPosition={{ measureIndex: 2, tick: 960 }}
        createEngraver={() => engraver}
      />,
    )
    await waitFor(() => expect(engraver.moveCursorTo).toHaveBeenCalledWith(2, 960))
  })

  it('exposes an imperative handle that forwards to the engraver', async () => {
    const engraver = createFakeEngraver()
    const score = makeTestScore()
    const ref = createRef<ScoreViewerHandle>()
    render(
      <ScoreViewer ref={ref} musicXml="<xml/>" score={score} createEngraver={() => engraver} />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

    ref.current?.moveCursorTo(1, 480)
    ref.current?.setNoteColor('m0.r.0.60', '#ff0000')
    ref.current?.clearNoteColors()
    ref.current?.setNoteHidden('m0.r.0.60', true)
    ref.current?.clearHiddenNotes()

    expect(engraver.moveCursorTo).toHaveBeenCalledWith(1, 480)
    expect(engraver.setNoteColor).toHaveBeenCalledWith('m0.r.0.60', '#ff0000')
    expect(engraver.clearNoteColors).toHaveBeenCalledTimes(1)
    expect(engraver.setNoteHidden).toHaveBeenCalledWith('m0.r.0.60', true)
    expect(engraver.clearHiddenNotes).toHaveBeenCalledTimes(1)
  })

  it('shows a readable error if the engraver fails to load, instead of crashing', async () => {
    const engraver = createFakeEngraver(Promise.reject(new Error('malformed score')))
    const score = makeTestScore()
    const { findByRole } = render(
      <ScoreViewer musicXml="<xml/>" score={score} createEngraver={() => engraver} />,
    )
    const alert = await findByRole('alert')
    expect(alert.textContent).toContain('malformed score')
  })

  it('destroys the engraver on unmount', async () => {
    const engraver = createFakeEngraver()
    const score = makeTestScore()
    const { unmount } = render(
      <ScoreViewer musicXml="<xml/>" score={score} createEngraver={() => engraver} />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

    unmount()
    expect(engraver.destroy).toHaveBeenCalledTimes(1)
  })

  it('creates a fresh engraver and destroys the old one when the score changes', async () => {
    const engraverA = createFakeEngraver()
    const engraverB = createFakeEngraver()
    const factory = vi.fn().mockReturnValueOnce(engraverA).mockReturnValueOnce(engraverB)
    const scoreA = makeTestScore()
    const scoreB = makeTestScore()
    const { rerender } = render(
      <ScoreViewer musicXml="<a/>" score={scoreA} createEngraver={factory} />,
    )
    await waitFor(() => expect(engraverA.load).toHaveBeenCalledTimes(1))

    rerender(<ScoreViewer musicXml="<b/>" score={scoreB} createEngraver={factory} />)

    await waitFor(() => expect(engraverB.load).toHaveBeenCalledTimes(1))
    expect(engraverA.destroy).toHaveBeenCalledTimes(1)
  })
})
