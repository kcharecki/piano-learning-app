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
import {
  createOsmdEngraver,
  DEFAULT_NOTE_COLOR,
  HIDDEN_NOTE_COLOR,
  type OsmdLike,
} from './osmdEngraver.ts'

// ---------------------------------------------------------------- fake OSMD

/**
 * The exact note shape `osmdEngraver.ts` reads/writes: halfTone, isRest(),
 * NoteheadColor, and ParentVoiceEntry.StemColor (the stem-recolouring fix —
 * see the `EngravedNote` doc comment in osmdEngraver.ts).
 */
type FakeNote = {
  halfTone: number
  isRest(): boolean
  NoteheadColor: string
  ParentVoiceEntry: { StemColor: string }
}

function note(halfTone: number, color = DEFAULT_NOTE_COLOR): FakeNote {
  return {
    halfTone,
    isRest: () => false,
    NoteheadColor: color,
    ParentVoiceEntry: { StemColor: color },
  }
}
function rest(): FakeNote {
  return {
    halfTone: 0,
    isRest: () => true,
    NoteheadColor: DEFAULT_NOTE_COLOR,
    ParentVoiceEntry: { StemColor: DEFAULT_NOTE_COLOR },
  }
}

/** One `VerticalSourceStaffEntryContainer`: notes spread across staves/voices at one tick. */
type FakeContainer = {
  readonly StaffEntries: ({ readonly VoiceEntries: { readonly Notes: FakeNote[] }[] } | undefined)[]
}

/** Wraps a flat list of `FakeNote`s, each in its own staff/voice, into one container. */
function containerOf(...notes: FakeNote[]): FakeContainer {
  return { StaffEntries: notes.map((n) => ({ VoiceEntries: [{ Notes: [n] }] })) }
}

/**
 * A container where some staves have NO entry at this vertical tick at all —
 * OSMD leaves that `StaffEntries` slot `undefined` rather than an entry with
 * an empty/rest voice, e.g. one hand sounds a note while the other rests.
 * `null` in `slots` models that gap; a `FakeNote` models a real entry.
 */
function sparseContainerOf(...slots: (FakeNote | undefined)[]): FakeContainer {
  return {
    StaffEntries: slots.map((n) => (n === undefined ? undefined : { VoiceEntries: [{ Notes: [n] }] })),
  }
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

/**
 * A cursor double that walks a fixed list of onset ticks, counting every call.
 * `load()` walks it once to cache the onsets, so the counters are zeroed after
 * that and every later number is per-frame cursor work — which is exactly what
 * the two bugs reported from the running app were made of.
 */
function makeFakeCursor(onsetTicks: readonly number[]): {
  readonly cursor: OsmdLike['cursor']
  calls: { reset: number; next: number; update: number; show: number }
  index: number
} {
  const state = {
    index: 0,
    calls: { reset: 0, next: 0, update: 0, show: 0 },
    cursor: {
      iterator: {
        get EndReached() {
          return state.index >= onsetTicks.length
        },
        CurrentSourceTimestamp: {
          // OSMD reports whole notes; the engraver multiplies by 4 * TPQ.
          get RealValue() {
            return (onsetTicks[Math.min(state.index, onsetTicks.length - 1)] ?? 0) / (4 * 480)
          },
        },
      },
      reset: () => {
        state.calls.reset += 1
        state.index = 0
      },
      next: () => {
        state.calls.next += 1
        state.index += 1
      },
      nextMeasure: () => {
        state.index += 1
      },
      update: () => {
        state.calls.update += 1
      },
      show: () => {
        state.calls.show += 1
      },
    },
  }
  return state
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
    // The stem is recoloured alongside the notehead (roadmap finding 5a).
    expect(engravedC60.ParentVoiceEntry.StemColor).toBe('red')
    expect(engravedC64.ParentVoiceEntry.StemColor).toBe('green')
    expect(engravedSingle.ParentVoiceEntry.StemColor).toBe('blue')
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

  it('does not throw, and still maps the real note, when a staff has NO entry at all at a tick (sparse StaffEntries)', async () => {
    // Regression: OSMD leaves a `StaffEntries` slot `undefined` — not an entry
    // with an empty voice — when one staff rests while another sounds a note
    // at the same tick. The bundled sample score hits this on nearly every
    // measure (right hand plays while the left hand's chord is silent, or vice
    // versa), and `buildNoteIdMap`'s `try/catch` was silently swallowing a
    // `TypeError` here, leaving the WHOLE map empty for that entire score —
    // note colouring (correct/wrong/missed feedback) and read-ahead occlusion
    // were both completely inert against the app's own default score. Caught
    // only by actually running the app, not by this suite before this test.
    const score = makeScore({
      id: 'sparse-staff-entries',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
    })
    const [only] = score.notes
    if (only === undefined) throw new Error('setup')

    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(sparseContainerOf(engravedNote, undefined))])

    const engraver = await load(score, fakeOsmd)
    engraver.setNoteHidden(only.id, true)

    expect(engravedNote.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
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

  // `setNoteColor` doesn't gate on the id resolving to a real note before
  // recording it (see `paint` in osmdEngraver.ts) — it always records the
  // desired colour, so a call that arrives before the note is mapped is never
  // silently dropped (roadmap finding 4). But `paint` itself returns `false`
  // for an id it can't resolve, so — roadmap finding 7 — no render is
  // scheduled for something that could never have changed on screen.
  it('setNoteColor on an unknown id does not throw, does not affect any real note, and schedules no render', async () => {
    const score = singleNoteScore()
    const engravedC60 = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedC60))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    expect(() => engraver.setNoteColor('no-such-id', 'red')).not.toThrow()

    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
    scheduler.flush()

    expect(engravedC60.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
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

describe('createOsmdEngraver: setNoteHidden / clearHiddenNotes (roadmap 2.26)', () => {
  it('setNoteHidden(id, true) paints the note the hidden colour', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteHidden(c60.id, true)
    scheduler.flush()

    expect(engravedNote.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
    // Hiding recolours the stem too, not just the notehead (roadmap finding 5a).
    expect(engravedNote.ParentVoiceEntry.StemColor).toBe(HIDDEN_NOTE_COLOR)
  })

  it('setNoteColor while a note is hidden does not change the rendered colour — hidden wins', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteHidden(c60.id, true)
    engraver.setNoteColor(c60.id, 'red')
    scheduler.flush()

    expect(engravedNote.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
  })

  it('setNoteHidden(id, false) reveals the colour requested while hidden, not the default', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteHidden(c60.id, true)
    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteHidden(c60.id, false)
    scheduler.flush()

    expect(engravedNote.NoteheadColor).toBe('red')
  })

  it('clearHiddenNotes reveals every hidden note at once, each with its own last-desired colour', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const fakeOsmd = makeFakeOsmd([
      measureOf(containerOf(engravedM0)),
      measureOf(containerOf(engravedM1a, engravedM1b)),
    ])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(m1noteA.id, 'green')
    engraver.setNoteHidden(m0note.id, true)
    engraver.setNoteHidden(m1noteA.id, true)
    engraver.setNoteHidden(m1noteB.id, true)
    scheduler.flush()
    expect(engravedM0.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
    expect(engravedM1a.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
    expect(engravedM1b.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)

    engraver.clearHiddenNotes()
    scheduler.flush()

    expect(engravedM0.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1a.NoteheadColor).toBe('green')
    expect(engravedM1b.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
  })

  it('clearNoteColors does NOT reveal a hidden note — hidden still wins over the inverse call', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteHidden(c60.id, true)
    engraver.clearNoteColors()
    scheduler.flush()

    expect(engravedNote.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
  })

  it('setNoteHidden on an unknown id does not throw, does not affect any real note, and schedules no render', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    expect(() => engraver.setNoteHidden('no-such-id', true)).not.toThrow()

    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
    scheduler.flush()

    expect(engravedNote.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
  })

  // Roadmap finding 7: `paint` reports no visible change for a note that is
  // already showing the colour it's being told to show — hidden wins, so
  // colouring a hidden note never actually touches `NoteheadColor`/
  // `StemColor`, and must not cost a wasted full-score re-render.
  it('setNoteColor on an already-hidden note does not schedule a render — hidden wins and nothing visible changes', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteHidden(c60.id, true)
    scheduler.flush()
    expect(scheduler.pending.length).toBe(0) // flushed: nothing left pending

    engraver.setNoteColor(c60.id, 'red')

    // No new render was scheduled for the already-hidden note's recolour.
    expect(scheduler.pending.length).toBe(0)
    expect(engravedNote.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
  })

  it('batches multiple hide/reveal calls inside one frame into exactly one render', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const fakeOsmd = makeFakeOsmd([
      measureOf(containerOf(engravedM0)),
      measureOf(containerOf(engravedM1a, engravedM1b)),
    ])
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteHidden(m0note.id, true)
    engraver.setNoteHidden(m1noteA.id, true)
    engraver.setNoteHidden(m1noteB.id, true)
    engraver.setNoteHidden(m0note.id, false)

    expect(fakeOsmd.renderCount).toBe(0)
    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(1)

    scheduler.flush()

    expect(fakeOsmd.renderCount).toBe(1)
    expect(engravedM0.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1a.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
    expect(engravedM1b.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
  })
})

describe('createOsmdEngraver: race with an in-flight load (roadmap finding 4)', () => {
  // `ScoreViewer` recreates its OSMD engraver instance synchronously whenever
  // its `score` prop identity changes, but this engraver's internal `osmd`
  // stays `undefined` until the async `load()` call resolves. A `setNoteHidden`
  // (or `setNoteColor`) call that lands in that window used to silently no-op
  // (the old `if (osmd === undefined) return` early return) while the caller
  // (`useReadAhead`) committed its own bookkeeping as if the hide had
  // succeeded — so it was never retried, and the note stayed permanently
  // un-hidden. This drives exactly that ordering with a controllable fake
  // `load()` promise: the hide call fires strictly BEFORE `load()` resolves.
  it('a setNoteHidden call made before load() resolves is caught up once noteById is populated, not silently dropped', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)

    let resolveLoad: () => void = () => undefined
    const fakeOsmd: FakeOsmd = {
      ...makeFakeOsmd([measureOf(containerOf(engravedNote))]),
      load: () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve
        }),
    }
    const scheduler = makeFakeScheduler()
    const engraver = createOsmdEngraver({
      createOsmd: () => fakeOsmd,
      scheduleRender: scheduler.scheduleRender,
    })

    const loadPromise = engraver.load(document.createElement('div'), '<score/>', score)

    // The race: this fires while `load()`'s internal `await instance.load(...)`
    // is still pending — `osmd` is still `undefined` and `noteById` is still
    // empty at this exact point.
    engraver.setNoteHidden(c60.id, true)
    expect(engravedNote.NoteheadColor).toBe(DEFAULT_NOTE_COLOR) // not yet mapped — nothing to paint yet

    resolveLoad()
    await loadPromise
    scheduler.flush()

    // The load-tail repaint catches the hide up: the note the fix was
    // supposed to lose is actually hidden once the engraver knows about it.
    expect(engravedNote.NoteheadColor).toBe(HIDDEN_NOTE_COLOR)
    expect(engravedNote.ParentVoiceEntry.StemColor).toBe(HIDDEN_NOTE_COLOR)
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

describe('cursor movement', () => {
  /**
   * Reported from the running app on an 87-measure MIDI import: the page
   * juddered up and down for as long as playback ran, and the sound lagged.
   * Both came from `moveCursorTo` rewinding the cursor to bar 1 and walking
   * forward again on EVERY frame — `followCursor` scrolls the page to wherever
   * the cursor is, and the walk is O(how far into the piece you are).
   *
   * These tests pin the two properties that fix it: a frame that does not
   * change which onset is sounding must touch the cursor not at all, and a
   * frame that advances must step FORWARD rather than reset.
   */
  const ONSETS = [0, 480, 960, 1440, 1920]

  async function loadWithCursor(): Promise<{
    engraver: ScoreEngraver
    cursor: ReturnType<typeof makeFakeCursor>
  }> {
    const cursor = makeFakeCursor(ONSETS)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    const withCursor: OsmdLike = { ...fakeOsmd, cursor: cursor.cursor }
    const engraver = createOsmdEngraver({ createOsmd: () => withCursor })
    await engraver.load(document.createElement('div'), '<xml/>', singleNoteScore())
    cursor.calls = { reset: 0, next: 0, update: 0, show: 0 }
    return { engraver, cursor }
  }

  it('does nothing at all on a frame that lands inside the onset already shown', async () => {
    const { engraver, cursor } = await loadWithCursor()

    engraver.moveCursorTo(0, 490)
    const afterFirst = { ...cursor.calls }
    // Sixty more frames inside the same quarter note — at 60fps this is one
    // second of playback, and it must cost nothing.
    for (let tick = 491; tick < 551; tick++) engraver.moveCursorTo(0, tick)

    expect(cursor.calls).toEqual(afterFirst)
  })

  it('steps forward, never rewinding, as the playhead advances', async () => {
    const { engraver, cursor } = await loadWithCursor()

    engraver.moveCursorTo(0, 500)
    engraver.moveCursorTo(0, 1000)
    engraver.moveCursorTo(1, 1930)

    // Onsets 0 -> 1 -> 2 -> 4 is four forward steps and no rewind. The old
    // implementation issued two resets and up to eight steps per call.
    expect(cursor.calls.next).toBe(4)
    expect(cursor.calls.reset).toBe(0)
  })

  it('rewinds only when the playhead goes backwards, as a loop wrap does', async () => {
    const { engraver, cursor } = await loadWithCursor()

    engraver.moveCursorTo(1, 1930)
    expect(cursor.calls.reset).toBe(0)

    engraver.moveCursorTo(0, 10)

    expect(cursor.calls.reset).toBe(1)
    expect(cursor.index).toBe(0)
  })

  it('parks on the sounding onset, not the one about to be reached', async () => {
    const { engraver, cursor } = await loadWithCursor()

    // A frame lands a few ticks past the 960 onset: the note AT 960 is
    // sounding, so the cursor belongs on it (index 2), not on 1440.
    engraver.moveCursorTo(0, 965)

    expect(cursor.index).toBe(2)
  })
})
