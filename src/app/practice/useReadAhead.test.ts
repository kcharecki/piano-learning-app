/**
 * `useReadAhead` decides which note ids should be occluded for the read-ahead
 * drill (roadmap 2.26, REQ-3.4.5) and diffs that set against what it hid last
 * time, so it never re-issues `setNoteHidden` for an id that is already in
 * the state it wants. Every test here drives the hook with a hand-built fake
 * `ReadAheadHandle` (plain `vi.fn()` spies) rather than a real `ScoreViewer` —
 * mirroring `useNoteFeedback.test.ts`'s `initialProps` + `rerender` pattern so
 * a fresh `Score` object is never built mid-render (which would otherwise
 * retrigger the effect via a changed `score` identity for the wrong reason).
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useReadAhead, type ReadAheadHandle, type UseReadAheadOptions } from './useReadAhead.ts'

/** Three measures, one note each, at 120bpm 4/4 (1920 ticks/measure). */
function threeMeasureScore(): Score {
  return makeScore({
    id: 'read-ahead-test',
    measures: [{}, {}, {}],
    notes: [
      { midi: 60, startTick: 0, durationTicks: 480, hand: 'right' },
      { midi: 62, startTick: 1920, durationTicks: 480, hand: 'right' },
      { midi: 64, startTick: 3840, durationTicks: 480, hand: 'right' },
    ],
  })
}

type FakeHandle = ReadAheadHandle & {
  readonly setNoteHidden: ReturnType<typeof vi.fn>
  readonly clearHiddenNotes: ReturnType<typeof vi.fn>
}

function fakeHandleRef(): RefObject<ReadAheadHandle | null> & { current: FakeHandle } {
  return {
    current: {
      setNoteHidden: vi.fn<(noteId: string, hidden: boolean) => void>(),
      clearHiddenNotes: vi.fn(),
    },
  }
}

function makeOptions(overrides: Partial<UseReadAheadOptions> = {}): UseReadAheadOptions {
  return {
    enabled: false,
    score: threeMeasureScore(),
    currentMeasureIndex: 0,
    scoreViewerRef: fakeHandleRef(),
    ...overrides,
  }
}

/** `setNoteHidden` calls of the form `(id, true)`, in call order. */
function hideCalls(handle: FakeHandle): string[] {
  return handle.setNoteHidden.mock.calls
    .filter(([, hidden]) => hidden === true)
    .map(([id]) => id)
}

/** `setNoteHidden` calls of the form `(id, false)`, in call order. */
function revealCalls(handle: FakeHandle): string[] {
  return handle.setNoteHidden.mock.calls
    .filter(([, hidden]) => hidden === false)
    .map(([id]) => id)
}

describe('useReadAhead', () => {
  it('enabling hides exactly the notes strictly BEFORE currentMeasureIndex — the current measure itself stays visible', () => {
    const options = makeOptions({ enabled: true, currentMeasureIndex: 1 })
    const score = options.score as Score
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>
    const [m0, m1, m2] = score.notes
    if (m0 === undefined || m1 === undefined || m2 === undefined) throw new Error('setup')

    renderHook((p: UseReadAheadOptions) => useReadAhead(p), { initialProps: options })

    // currentMeasureIndex is 1 (measure index 1) — only measure 0 is strictly
    // before it, so only m0 is hidden; m1 (the current measure, sitting under
    // the cursor's own highlight) and m2 (ahead) both stay visible.
    expect(hideCalls(scoreViewerRef.current)).toEqual([m0.id])
    expect(hideCalls(scoreViewerRef.current)).not.toContain(m1.id)
    expect(hideCalls(scoreViewerRef.current)).not.toContain(m2.id)
    expect(scoreViewerRef.current.clearHiddenNotes).not.toHaveBeenCalled()
  })

  it('at currentMeasureIndex 0, nothing is hidden — there is no measure before the first one', () => {
    const options = makeOptions({ enabled: true, currentMeasureIndex: 0 })
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>

    renderHook((p: UseReadAheadOptions) => useReadAhead(p), { initialProps: options })

    expect(scoreViewerRef.current.setNoteHidden).not.toHaveBeenCalled()
    expect(scoreViewerRef.current.clearHiddenNotes).not.toHaveBeenCalled()
  })

  it('advancing currentMeasureIndex hides more without re-hiding notes already hidden, and never hides the new current measure', () => {
    const options = makeOptions({ enabled: true, currentMeasureIndex: 1 })
    const score = options.score as Score
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>
    const [m0, m1, m2] = score.notes
    if (m0 === undefined || m1 === undefined || m2 === undefined) throw new Error('setup')

    const { rerender } = renderHook((p: UseReadAheadOptions) => useReadAhead(p), {
      initialProps: options,
    })
    expect(hideCalls(scoreViewerRef.current)).toEqual([m0.id])

    // Cursor advances to measure 2: measure 1 is now strictly before it, so it
    // joins the hidden set; measure 2 itself (now current) stays visible.
    rerender({ ...options, currentMeasureIndex: 2 })

    const allHideCalls = hideCalls(scoreViewerRef.current)
    // m0 must not be re-issued just because the cursor moved further past it.
    expect(allHideCalls.filter((id) => id === m0.id)).toHaveLength(1)
    expect(allHideCalls.filter((id) => id === m1.id)).toHaveLength(1)
    expect(allHideCalls).not.toContain(m2.id)
    expect(new Set(allHideCalls)).toEqual(new Set([m0.id, m1.id]))
  })

  it('disabling calls clearHiddenNotes() and issues no further setNoteHidden calls', () => {
    const options = makeOptions({ enabled: true, currentMeasureIndex: 1 })
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>

    const { rerender } = renderHook((p: UseReadAheadOptions) => useReadAhead(p), {
      initialProps: options,
    })
    scoreViewerRef.current.setNoteHidden.mockClear()

    rerender({ ...options, enabled: false })

    expect(scoreViewerRef.current.clearHiddenNotes).toHaveBeenCalledTimes(1)
    expect(scoreViewerRef.current.setNoteHidden).not.toHaveBeenCalled()
  })

  it('does nothing when never enabled (no hidden notes to clear)', () => {
    const options = makeOptions({ enabled: false })
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>

    renderHook((p: UseReadAheadOptions) => useReadAhead(p), { initialProps: options })

    expect(scoreViewerRef.current.setNoteHidden).not.toHaveBeenCalled()
    expect(scoreViewerRef.current.clearHiddenNotes).not.toHaveBeenCalled()
  })

  it('score === undefined behaves like disabled: clears whatever was hidden, hides nothing new', () => {
    const options = makeOptions({ enabled: true, currentMeasureIndex: 1 })
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>

    const { rerender } = renderHook((p: UseReadAheadOptions) => useReadAhead(p), {
      initialProps: options,
    })
    scoreViewerRef.current.setNoteHidden.mockClear()

    rerender({ ...options, score: undefined })

    expect(scoreViewerRef.current.clearHiddenNotes).toHaveBeenCalledTimes(1)
    expect(scoreViewerRef.current.setNoteHidden).not.toHaveBeenCalled()
  })

  it('toggling back on after off re-hides the correct notes', () => {
    // currentMeasureIndex 1 so measure 0 is actually hidden (0 itself hides
    // nothing — there's no measure before the first one).
    const options = makeOptions({ enabled: true, currentMeasureIndex: 1 })
    const score = options.score as Score
    const scoreViewerRef = options.scoreViewerRef as ReturnType<typeof fakeHandleRef>
    const [m0] = score.notes
    if (m0 === undefined) throw new Error('setup')

    const { rerender } = renderHook((p: UseReadAheadOptions) => useReadAhead(p), {
      initialProps: options,
    })
    rerender({ ...options, enabled: false })
    scoreViewerRef.current.setNoteHidden.mockClear()
    scoreViewerRef.current.clearHiddenNotes.mockClear()

    rerender({ ...options, enabled: true, currentMeasureIndex: 1 })

    expect(hideCalls(scoreViewerRef.current)).toEqual([m0.id])
    expect(revealCalls(scoreViewerRef.current)).toEqual([])
  })
})
