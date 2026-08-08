/**
 * `ScoreViewer` drives OSMD through the `ScoreEngraver` seam, and OSMD does
 * not run in happy-dom — so every test here drives the component with a fake
 * engraver and asserts on the wiring, never on OSMD's own behaviour.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
  readonly noteIdAt: ReturnType<typeof vi.fn>
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
    noteIdAt: vi.fn(() => undefined),
  }
}

/** A `FakeEngraver` that ALSO implements the optional `setMeasureLabels`
 *  (roadmap 3.18a) — plain `FakeEngraver` deliberately omits it, so the
 *  "absent prop means today's behaviour" tests can prove nothing calls a
 *  method that isn't even there, while these tests prove the wiring for an
 *  engraver that does have it (the real `createOsmdEngraver` always does). */
type FakeEngraverWithLabels = FakeEngraver & {
  readonly setMeasureLabels: ReturnType<typeof vi.fn>
}

function createFakeEngraverWithLabels(): FakeEngraverWithLabels {
  return { ...createFakeEngraver(), setMeasureLabels: vi.fn() }
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

  it('calls onSelectNote with the id the engraver resolves for the click target (roadmap 4.8a)', async () => {
    const engraver = createFakeEngraver()
    engraver.noteIdAt.mockReturnValue('m0.r.0.60')
    const score = makeTestScore()
    const onSelectNote = vi.fn()
    const { getByTestId } = render(
      <ScoreViewer
        musicXml="<xml/>"
        score={score}
        createEngraver={() => engraver}
        onSelectNote={onSelectNote}
      />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

    const container = getByTestId('score-container')
    fireEvent.click(container)

    expect(engraver.noteIdAt).toHaveBeenCalledTimes(1)
    expect(engraver.noteIdAt).toHaveBeenCalledWith(container)
    expect(onSelectNote).toHaveBeenCalledWith('m0.r.0.60')
  })

  it('resolves the click against event.target, not the container — a click on a CHILD element must be what noteIdAt is called with (roadmap-review finding 6)', async () => {
    const engraver = createFakeEngraver()
    engraver.noteIdAt.mockReturnValue('m0.r.0.60')
    const score = makeTestScore()
    const onSelectNote = vi.fn()
    const { getByTestId } = render(
      <ScoreViewer
        musicXml="<xml/>"
        score={score}
        createEngraver={() => engraver}
        onSelectNote={onSelectNote}
      />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

    const container = getByTestId('score-container')
    const child = document.createElement('span')
    container.appendChild(child)

    fireEvent.click(child)

    // Pins that the handler passes `event.target` (the actual click target,
    // which may be deep inside a notehead's SVG) through to the engraver,
    // NOT `event.currentTarget` — the latter always resolves to the
    // container itself, which the real engraver's `noteIdAt` treats as a
    // miss regardless of where inside it the click actually landed.
    expect(engraver.noteIdAt).toHaveBeenCalledWith(child)
    expect(onSelectNote).toHaveBeenCalledWith('m0.r.0.60')
  })

  it('calls onSelectNote with undefined when the click misses every notehead', async () => {
    const engraver = createFakeEngraver()
    engraver.noteIdAt.mockReturnValue(undefined)
    const score = makeTestScore()
    const onSelectNote = vi.fn()
    const { getByTestId } = render(
      <ScoreViewer
        musicXml="<xml/>"
        score={score}
        createEngraver={() => engraver}
        onSelectNote={onSelectNote}
      />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

    fireEvent.click(getByTestId('score-container'))

    expect(onSelectNote).toHaveBeenCalledWith(undefined)
  })

  it('does not throw on a click when no onSelectNote callback was given', async () => {
    const engraver = createFakeEngraver()
    const score = makeTestScore()
    const { getByTestId } = render(
      <ScoreViewer musicXml="<xml/>" score={score} createEngraver={() => engraver} />,
    )
    await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

    expect(() => fireEvent.click(getByTestId('score-container'))).not.toThrow()
  })

  describe('measureLabels (roadmap 3.18a)', () => {
    it('forwards measureLabels to the engraver once it has loaded', async () => {
      const engraver = createFakeEngraverWithLabels()
      const score = makeTestScore()
      const labels = new Map([[1, 'I']])
      render(
        <ScoreViewer
          musicXml="<xml/>"
          score={score}
          createEngraver={() => engraver}
          measureLabels={labels}
        />,
      )
      await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

      await waitFor(() => expect(engraver.setMeasureLabels).toHaveBeenCalledWith(labels))
    })

    it('forwards a new measureLabels map when the prop changes', async () => {
      const engraver = createFakeEngraverWithLabels()
      const score = makeTestScore()
      const { rerender } = render(
        <ScoreViewer
          musicXml="<xml/>"
          score={score}
          createEngraver={() => engraver}
          measureLabels={new Map([[1, 'I']])}
        />,
      )
      await waitFor(() => expect(engraver.setMeasureLabels).toHaveBeenCalledWith(new Map([[1, 'I']])))

      const nextLabels = new Map([[1, 'IV']])
      rerender(
        <ScoreViewer
          musicXml="<xml/>"
          score={score}
          createEngraver={() => engraver}
          measureLabels={nextLabels}
        />,
      )

      await waitFor(() => expect(engraver.setMeasureLabels).toHaveBeenCalledWith(nextLabels))
    })

    it('never calls setMeasureLabels when the prop is absent — absent means today\'s behaviour exactly', async () => {
      // Plain `createFakeEngraver()` deliberately has no `setMeasureLabels` at
      // all (unlike `createFakeEngraverWithLabels`) — this only compiles, let
      // alone passes, if ScoreViewer truly never calls it when `measureLabels`
      // is not given.
      const engraver = createFakeEngraver()
      const score = makeTestScore()
      render(<ScoreViewer musicXml="<xml/>" score={score} createEngraver={() => engraver} />)

      await waitFor(() => expect(engraver.load).toHaveBeenCalledTimes(1))

      expect((engraver as Partial<FakeEngraverWithLabels>).setMeasureLabels).toBeUndefined()
    })

    it('forwards the same measureLabels Map to the NEW engraver when the score changes (roadmap-review finding 1)', async () => {
      const engraverA = createFakeEngraverWithLabels()
      const engraverB = createFakeEngraverWithLabels()
      const factory = vi.fn().mockReturnValueOnce(engraverA).mockReturnValueOnce(engraverB)
      const scoreA = makeTestScore()
      const scoreB = makeTestScore()
      const labels = new Map([[1, 'I']]) // same Map identity across the rerender
      const { rerender } = render(
        <ScoreViewer
          musicXml="<a/>"
          score={scoreA}
          createEngraver={factory}
          measureLabels={labels}
        />,
      )
      await waitFor(() => expect(engraverA.setMeasureLabels).toHaveBeenCalledWith(labels))

      rerender(
        <ScoreViewer
          musicXml="<b/>"
          score={scoreB}
          createEngraver={factory}
          measureLabels={labels}
        />,
      )

      await waitFor(() => expect(engraverB.load).toHaveBeenCalledTimes(1))
      // The old engraver's label map was wiped by destroy(); if the effect
      // only depended on `[measureLabels]`, this would never fire because
      // the Map identity did not change — the labels would silently vanish
      // from the new engraving.
      await waitFor(() => expect(engraverB.setMeasureLabels).toHaveBeenCalledWith(labels))
    })

    it('does not throw when measureLabels is given but the engraver has no setMeasureLabels (an older/plain ScoreEngraver fake)', async () => {
      const engraver = createFakeEngraver()
      const score = makeTestScore()
      expect(() =>
        render(
          <ScoreViewer
            musicXml="<xml/>"
            score={score}
            createEngraver={() => engraver}
            measureLabels={new Map([[1, 'I']])}
          />,
        ),
      ).not.toThrow()
    })
  })
})
