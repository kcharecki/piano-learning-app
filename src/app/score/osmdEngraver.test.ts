/**
 * `osmdEngraver.ts` is the only file in `src/app/score/` that had never been
 * tested (roadmap 2.22) — OSMD itself cannot run in happy-dom, but everything
 * this file does BEFORE it hands work to the real library is plain logic:
 * the id -> engraved-note zip (`buildNoteIdMap`/`flattenMeasureNotes`) and the
 * render-batching added in the same roadmap task (2.21). Both are exercised
 * here with a fake `OsmdLike` (the `createOsmd` injection seam) and a fake
 * `scheduleRender`, so no DOM/canvas render ever runs.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { describe, expect, it, vi } from 'vitest'
import type { ScoreEngraver } from './engraver.ts'
import { createOsmdEngraver, DEFAULT_NOTE_COLOR, type OsmdLike } from './osmdEngraver.ts'

// ---------------------------------------------------------------- fake OSMD

/** The exact note shape `osmdEngraver.ts` reads/writes: halfTone, isRest(), NoteheadColor. */
type FakeNote = { halfTone: number; isRest(): boolean; NoteheadColor: string }

function note(halfTone: number, color = DEFAULT_NOTE_COLOR): FakeNote {
  return { halfTone, isRest: () => false, NoteheadColor: color }
}
function rest(): FakeNote {
  return { halfTone: 0, isRest: () => true, NoteheadColor: DEFAULT_NOTE_COLOR }
}

/** One `VerticalSourceStaffEntryContainer`: notes spread across staves/voices at one tick. */
type FakeContainer = { readonly StaffEntries: { readonly VoiceEntries: { readonly Notes: FakeNote[] }[] }[] }

/** Wraps a flat list of `FakeNote`s, each in its own staff/voice, into one container. */
function containerOf(...notes: FakeNote[]): FakeContainer {
  return { StaffEntries: notes.map((n) => ({ VoiceEntries: [{ Notes: [n] }] })) }
}

type FakeMeasure = { readonly VerticalSourceStaffEntryContainers: readonly FakeContainer[] }

function measureOf(...containers: FakeContainer[]): FakeMeasure {
  return { VerticalSourceStaffEntryContainers: containers }
}

type FakeOsmd = OsmdLike & {
  renderCount: number
  cleared: boolean
}

function makeFakeOsmd(measures: readonly FakeMeasure[]): FakeOsmd {
  return {
    Sheet: { SourceMeasures: measures },
    cursor: {
      iterator: { EndReached: true, CurrentSourceTimestamp: { RealValue: 0 } },
      reset: () => undefined,
      next: () => undefined,
      nextMeasure: () => undefined,
      update: () => undefined,
      show: () => undefined,
    },
    async load() {
      /* no-op — the fake is "loaded" from construction */
    },
    render() {
      this.renderCount += 1
    },
    clear() {
      this.cleared = true
    },
    renderCount: 0,
    cleared: false,
  }
}

/** A `scheduleRender` double that captures each pending flush instead of running it. */
function makeFakeScheduler(): {
  readonly scheduleRender: (run: () => void) => void
  readonly pending: (() => void)[]
  flush(): void
} {
  const pending: (() => void)[] = []
  return {
    scheduleRender: vi.fn((run: () => void) => pending.push(run)),
    pending,
    flush() {
      const runs = pending.splice(0, pending.length)
      for (const run of runs) run()
    },
  }
}

// -------------------------------------------------------------------- scores

/** measure 0: chord (60, 64) at tick 0, single note (67) at tick 480. */
function chordAndSingleScore(): Score {
  return makeScore({
    id: 'chord-and-single',
    measures: [{}],
    notes: [
      { midi: 60, startTick: 0, durationTicks: 480, hand: 'right' },
      { midi: 64, startTick: 0, durationTicks: 480, hand: 'right' },
      { midi: 67, startTick: 480, durationTicks: 1440, hand: 'right' },
    ],
  })
}

/** Two measures: measure 0 has one note, measure 1 has two. */
function twoMeasureScore(): Score {
  return makeScore({
    id: 'two-measure',
    measures: [{}, {}],
    notes: [
      { midi: 60, startTick: 0, durationTicks: 480, hand: 'right' },
      { midi: 62, startTick: 1920, durationTicks: 480, hand: 'right' },
      { midi: 65, startTick: 2400, durationTicks: 480, hand: 'right' },
    ],
  })
}

/** One measure, one note — the whole score used for the batching tests, where the mapping itself is not what's under test. */
function singleNoteScore(): Score {
  return makeScore({
    id: 'single-note',
    measures: [{}],
    notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
  })
}

/**
 * Loads `score` into a fresh engraver against `fakeOsmd`, and zeroes
 * `renderCount` afterwards — `load()` itself calls `render()` once,
 * synchronously and unbatched (the initial engrave), which is not part of
 * what the batching tests below are asserting on.
 */
async function load(
  score: Score,
  fakeOsmd: FakeOsmd,
  scheduleRender?: (run: () => void) => void,
): Promise<ScoreEngraver> {
  const engraver = createOsmdEngraver({
    createOsmd: () => fakeOsmd,
    ...(scheduleRender === undefined ? {} : { scheduleRender }),
  })
  await engraver.load(document.createElement('div'), '<score/>', score)
  fakeOsmd.renderCount = 0
  return engraver
}

// ----------------------------------------------------------------------- tests

describe('createOsmdEngraver: id -> engraved-note mapping', () => {
  it('maps ids in the documented order: our notes by startTick/midi vs theirs flattened by container/staff/voice/halfTone', async () => {
    const score = chordAndSingleScore()
    const [c60, c64, single67] = score.notes
    if (c60 === undefined || c64 === undefined || single67 === undefined) throw new Error('setup')

    // Deliberately scrambled staff order within the chord's container (m64
    // engraved in staff entry 0, m60 in staff entry 1) — flattenMeasureNotes
    // must still sort by halfTone, so the zip lands on ours' startTick/midi
    // order regardless of which staff/voice OSMD happened to put each in.
    const engravedC64 = note(64)
    const engravedC60 = note(60)
    const engravedSingle = note(67)
    const fakeOsmd = makeFakeOsmd([
      measureOf(containerOf(engravedC64, engravedC60), containerOf(engravedSingle)),
    ])

    const engraver = await load(score, fakeOsmd)

    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteColor(c64.id, 'green')
    engraver.setNoteColor(single67.id, 'blue')

    expect(engravedC60.NoteheadColor).toBe('red')
    expect(engravedC64.NoteheadColor).toBe('green')
    expect(engravedSingle.NoteheadColor).toBe('blue')
  })

  it('skips rests when counting/flattening a measure, so a real note is still mapped correctly', async () => {
    const score = makeScore({
      id: 'with-rest',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
    })
    const [only] = score.notes
    if (only === undefined) throw new Error('setup')

    const engravedNote = note(60)
    // A rest sitting alongside the real note: if flattenMeasureNotes counted
    // it, theirs.length (2) would disagree with ours.length (1) and the
    // whole measure would go unmapped.
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(rest(), engravedNote))])

    const engraver = await load(score, fakeOsmd)
    engraver.setNoteColor(only.id, 'purple')

    expect(engravedNote.NoteheadColor).toBe('purple')
  })

  it('leaves a measure with a mismatched note count UNMAPPED, while other measures still map', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }

    const engravedM0 = note(60)
    // measure 1 declares 3 engraved notes for score's 2 — a mismatch.
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const engravedM1extra = note(69)
    const fakeOsmd = makeFakeOsmd([
      measureOf(containerOf(engravedM0)),
      measureOf(containerOf(engravedM1a, engravedM1b, engravedM1extra)),
    ])

    const engraver = await load(score, fakeOsmd)

    // Half 1: the matching measure (0) still maps and colours correctly.
    engraver.setNoteColor(m0note.id, 'orange')
    expect(engravedM0.NoteheadColor).toBe('orange')

    // Half 2: the mismatched measure (1) is left entirely uncoloured — the
    // current silent no-op behaviour this test pins.
    engraver.setNoteColor(m1noteA.id, 'orange')
    engraver.setNoteColor(m1noteB.id, 'orange')
    expect(engravedM1a.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1b.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1extra.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
  })

  it('setNoteColor on an unknown id is a no-op', async () => {
    const score = singleNoteScore()
    const engravedC60 = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedC60))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    expect(() => engraver.setNoteColor('no-such-id', 'red')).not.toThrow()
    scheduler.flush()

    expect(engravedC60.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(fakeOsmd.renderCount).toBe(0)
    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
  })
})

describe('createOsmdEngraver: clearNoteColors', () => {
  it('restores the default colour on exactly the ids that were coloured', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    // Never coloured, and its "engraved" colour is a sentinel distinct from
    // both DEFAULT_NOTE_COLOR and anything setNoteColor writes below — proves
    // clearNoteColors only touches ids that WERE coloured, not every mapped note.
    const untouchedSentinel = '#123456'
    const engravedM1b = note(65, untouchedSentinel)
    const fakeOsmd = makeFakeOsmd([
      measureOf(containerOf(engravedM0)),
      measureOf(containerOf(engravedM1a, engravedM1b)),
    ])
    const engraver = await load(score, fakeOsmd)

    engraver.setNoteColor(m0note.id, 'red')
    engraver.setNoteColor(m1noteA.id, 'green')
    expect(engravedM0.NoteheadColor).toBe('red')
    expect(engravedM1a.NoteheadColor).toBe('green')

    engraver.clearNoteColors()

    expect(engravedM0.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1a.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    // m1noteB was never coloured — untouched by clear.
    expect(engravedM1b.NoteheadColor).toBe(untouchedSentinel)
  })
})

describe('createOsmdEngraver: batched rendering (roadmap 2.21)', () => {
  it('N setNoteColor calls inside one frame produce exactly ONE render, with the last colour written', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteColor(c60.id, 'green')
    engraver.setNoteColor(c60.id, 'blue')

    // Not flushed yet: no render has actually happened, but the colour
    // mutation itself is already applied (it is the render call that is
    // deferred, not the mutation).
    expect(fakeOsmd.renderCount).toBe(0)
    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(1)

    scheduler.flush()

    expect(fakeOsmd.renderCount).toBe(1)
    expect(engravedNote.NoteheadColor).toBe('blue')
  })

  it('coalesces setNoteColor and clearNoteColors together into one render', async () => {
    const score = chordAndSingleScore()
    const [c60, c64, single67] = score.notes
    if (c60 === undefined || c64 === undefined || single67 === undefined) throw new Error('setup')
    const engravedC60 = note(60)
    const engravedC64 = note(64)
    const engravedSingle = note(67)
    const fakeOsmd = makeFakeOsmd([
      measureOf(containerOf(engravedC60, engravedC64), containerOf(engravedSingle)),
    ])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteColor(c64.id, 'green')
    engraver.clearNoteColors()

    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(1)
    scheduler.flush()

    expect(fakeOsmd.renderCount).toBe(1)
    expect(engravedC60.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedC64.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
  })

  it('schedules a fresh render for calls made after the previous frame flushed', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    scheduler.flush()
    expect(fakeOsmd.renderCount).toBe(1)

    engraver.setNoteColor(c60.id, 'green')
    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(2)
    scheduler.flush()
    expect(fakeOsmd.renderCount).toBe(2)
  })

  it('destroy() neutralises a pending batched render — it never fires against the cleared instance', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    expect(scheduler.pending.length).toBe(1)

    engraver.destroy()
    expect(fakeOsmd.cleared).toBe(true)

    // The rAF/timeout this test's fake scheduler captured still "fires" —
    // exactly what would happen for real if destroy() ran between a real
    // requestAnimationFrame call and the frame it scheduled.
    expect(() => scheduler.flush()).not.toThrow()
    expect(fakeOsmd.renderCount).toBe(0)
  })

  it('falls back to a timeout when requestAnimationFrame is not defined (e.g. a non-DOM environment)', async () => {
    vi.useFakeTimers()
    const original = globalThis.requestAnimationFrame
    // @ts-expect-error -- simulating an environment with no rAF, as the doc comment describes
    delete globalThis.requestAnimationFrame
    try {
      const score = singleNoteScore()
      const [c60] = score.notes
      if (c60 === undefined) throw new Error('setup')
      const engravedNote = note(60)
      const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
      const engraver = await load(score, fakeOsmd)

      engraver.setNoteColor(c60.id, 'red')
      expect(fakeOsmd.renderCount).toBe(0)

      await vi.runAllTimersAsync()

      expect(fakeOsmd.renderCount).toBe(1)
      expect(engravedNote.NoteheadColor).toBe('red')
    } finally {
      globalThis.requestAnimationFrame = original
      vi.useRealTimers()
    }
  })
})
