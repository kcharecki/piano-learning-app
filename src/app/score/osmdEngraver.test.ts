/**
 * `osmdEngraver.ts` is the only file in `src/app/score/` that had never been
 * tested (roadmap 2.22) — OSMD itself cannot run in happy-dom, but everything
 * this file does BEFORE it hands work to the real library is plain logic:
 * the id -> engraved-note zip (`buildNoteIdMap`/`flattenMeasureNotes`) and the
 * render-batching added in the same roadmap task (2.21). Both are exercised
 * here with a fake `OsmdLike` (the `createOsmd` injection seam) and a fake
 * `scheduleRender`, so no DOM/canvas render ever runs.
 */
import { makeScore } from '@core/notation/score.ts'
import { describe, expect, it, vi } from 'vitest'
import {
  createOsmdEngraver,
  resolveOsmdOptions,
  type ScoreEngraverWithMeasureLabels,
} from './osmdEngraver.ts'
import {
  DEFAULT_NOTE_COLOR,
  FEEDBACK_CORRECT_COLOR,
  FEEDBACK_MISSED_COLOR,
  FEEDBACK_WRONG_COLOR,
  HIDDEN_NOTE_COLOR,
  type OsmdLike,
} from './osmdSvg.ts'
import {
  chordAndSingleScore,
  containerOf,
  containerWithSvg,
  fakeGraphicalMeasure,
  fakeStave,
  gNoteMissing,
  gNoteThrowing,
  load,
  makeFakeCursor,
  makeFakeOsmd,
  makeFakeScheduler,
  makeGNoteForChord,
  makeGNoteRecording,
  makeGNoteWithElements,
  makeUnboundedFakeCursor,
  measureOf,
  note,
  rest,
  singleNoteScore,
  sparseContainerOf,
  twoMeasureScore,
  withGraphicSheet,
  type FakeGNote,
  type FakeNote,
  type FakeOsmd,
} from '@test/osmdEngraverFakes.ts'


// ----------------------------------------------------------------------- tests

// `resolveOsmdOptions` is the pure function `defaultCreateOsmd` hands
// straight to `new OpenSheetMusicDisplay(container, options)` — real OSMD
// cannot run in happy-dom (see this file's own module doc comment), so this
// is the only way a test reads the ACTUAL constructor options a `chrome`
// value produces, rather than merely asserting a prop was accepted
// (roadmap UI-06's acceptance criterion 1).
describe('resolveOsmdOptions (roadmap UI-06 — chrome.title)', () => {
  it('chrome absent, empty, title:true, or compact-only all return the SAME options reference as no chrome — every existing caller\'s engraving is byte-for-byte unchanged', () => {
    const practice = resolveOsmdOptions('practice')
    for (const chrome of [undefined, {}, { title: true }, { compact: true }] as const)
      expect(resolveOsmdOptions('practice', chrome)).toBe(practice)
    expect(practice).toEqual(expect.objectContaining({ drawTitle: true, autoResize: false }))
  })

  it('chrome.title: false suppresses drawTitle AND drawComposer, leaving other practice defaults untouched', () => {
    const options = resolveOsmdOptions('practice', { title: false })
    expect(options).toEqual(expect.objectContaining({ drawTitle: false, drawComposer: false, autoResize: false }))
  })
})

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

// None of these fakes pass a `GNote` to `makeFakeOsmd`, so they default to
// `gNoteMissing` — every `paint` call here takes the `'needs-render'`
// fallback. That used to be the ONLY path (roadmap 2.21); since the 2.3x
// performance round it is the fallback for when the fast SVG path (see the
// `setColor fast path` describe below) is unavailable, but the batching
// guarantees these tests pin are unchanged either way.
describe('createOsmdEngraver: batched rendering (roadmap 2.21, now the needs-render fallback)', () => {
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

describe('createOsmdEngraver: setColor fast path (2.3x performance round)', () => {
  // The point of the whole task: recolouring must not cost a re-engrave when
  // OSMD can resolve a graphical note for it. This is what would fail if
  // anyone reintroduced a `requestRender()` on the colour path.
  it('N setNoteColor calls against a mapped score schedule ZERO renders, each calling setColor with the requested colour and the notehead+stem options', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const gnote = makeGNoteRecording()
    const fakeOsmd = makeFakeOsmd(
      [measureOf(containerOf(engravedM0)), measureOf(containerOf(engravedM1a, engravedM1b))],
      gnote.GNote,
    )
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(m0note.id, 'red')
    engraver.setNoteColor(m1noteA.id, 'green')
    engraver.setNoteColor(m1noteB.id, 'blue')

    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
    expect(fakeOsmd.renderCount).toBe(0)
    const options = { applyToNoteheads: true, applyToStem: true }
    expect(gnote.calls).toEqual([
      { color: 'red', options },
      { color: 'green', options },
      { color: 'blue', options },
    ])
  })

  it('re-colouring a note to the colour it already holds calls setColor zero times and schedules zero renders', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60, 'red')
    const gnote = makeGNoteRecording()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')

    expect(gnote.calls).toEqual([])
    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
  })

  it('keeps NoteheadColor/StemColor set on the model after a setColor-path paint — durability against an OSMD-initiated re-render (autoResize)', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteRecording()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')

    // Asserted on the note object itself, not the setColor stub: the model
    // write must stand even though the SVG was already updated directly.
    expect(engravedNote.NoteheadColor).toBe('red')
    expect(engravedNote.ParentVoiceEntry.StemColor).toBe('red')
    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
  })

  it('falls back to a render when GNote is unavailable (returns undefined): N calls in one task still schedule EXACTLY ONE render', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gNoteMissing)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteColor(c60.id, 'green')
    engraver.setNoteColor(c60.id, 'blue')

    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(1)
    scheduler.flush()
    expect(fakeOsmd.renderCount).toBe(1)
    expect(engravedNote.NoteheadColor).toBe('blue')
  })

  it('falls back to a render when GNote throws: no exception escapes, and N calls in one task still schedule EXACTLY ONE render', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gNoteThrowing)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    expect(() => {
      engraver.setNoteColor(c60.id, 'red')
      engraver.setNoteColor(c60.id, 'green')
    }).not.toThrow()

    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(1)
    scheduler.flush()
    expect(fakeOsmd.renderCount).toBe(1)
    expect(engravedNote.NoteheadColor).toBe('green')
  })

  it('hidden-over-colour precedence holds through the setColor path: hiding pushes HIDDEN_NOTE_COLOR, revealing pushes back the last requested colour', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteRecording()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, 'red')
    engraver.setNoteHidden(c60.id, true)
    engraver.setNoteHidden(c60.id, false)

    expect(gnote.calls.map((c) => c.color)).toEqual(['red', HIDDEN_NOTE_COLOR, 'red'])
    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
  })

  it('clearNoteColors and clearHiddenNotes over many ids schedule zero renders on the setColor path', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const gnote = makeGNoteRecording()
    const fakeOsmd = makeFakeOsmd(
      [measureOf(containerOf(engravedM0)), measureOf(containerOf(engravedM1a, engravedM1b))],
      gnote.GNote,
    )
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(m0note.id, 'red')
    engraver.setNoteColor(m1noteA.id, 'green')
    engraver.setNoteHidden(m1noteB.id, true)
    expect(scheduler.scheduleRender).not.toHaveBeenCalled()

    engraver.clearNoteColors()
    engraver.clearHiddenNotes()

    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
    expect(fakeOsmd.renderCount).toBe(0)
    expect(engravedM0.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1a.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
    expect(engravedM1b.NoteheadColor).toBe(DEFAULT_NOTE_COLOR)
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
    engraver: ScoreEngraverWithMeasureLabels
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

describe('createOsmdEngraver: presentation (roadmap 3.14)', () => {
  const ONSETS = [0, 480, 960]

  async function loadWith(
    opts: Parameters<typeof createOsmdEngraver>[0],
  ): Promise<ReturnType<typeof makeFakeCursor>> {
    const cursor = makeFakeCursor(ONSETS)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    const withCursor: OsmdLike = { ...fakeOsmd, cursor: cursor.cursor }
    const engraver = createOsmdEngraver({ ...opts, createOsmd: () => withCursor })
    await engraver.load(document.createElement('div'), '<xml/>', singleNoteScore())
    return cursor
  }

  it("shows the playback cursor by default, so every existing caller is unchanged", async () => {
    const cursor = await loadWith(undefined)
    expect(cursor.calls.show).toBe(1)
  })

  it('never shows a playback cursor on a reference score', async () => {
    // The scale staff on the theory reference has nothing playing it, so a
    // cursor parked on its first note is a lie about state.
    const cursor = await loadWith({ presentation: 'reference' })
    expect(cursor.calls.show).toBe(0)
  })

  it('still caches the onsets in reference mode, so moveCursorTo stays usable', async () => {
    const cursor = await loadWith({ presentation: 'reference' })
    // The load-time walk visits every onset whichever mode it is in — hiding
    // the cursor must not also disable cursor movement.
    expect(cursor.calls.next).toBeGreaterThanOrEqual(ONSETS.length)
  })
})

describe('createOsmdEngraver: MAX_CURSOR_STEPS cap (roadmap 2.32f)', () => {
  // Negative case first: an ordinary short score never comes near the cap,
  // so the cap-reached warning must never fire for it.
  it('does not warn when the onset walk reaches EndReached well under the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const cursor = makeFakeCursor([0, 480, 960, 1440, 1920])
      const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
      const withCursor: OsmdLike = { ...fakeOsmd, cursor: cursor.cursor }
      const engraver = createOsmdEngraver({ createOsmd: () => withCursor })

      await engraver.load(document.createElement('div'), '<xml/>', singleNoteScore())

      expect(warn).not.toHaveBeenCalled()
      // The walk actually collected the onsets (not just reset back to the
      // start, which `collectOnsetTicks` does unconditionally regardless of
      // whether anything was collected): five onsets crossed means five
      // `next()` calls.
      expect(cursor.calls.next).toBe(5)
    } finally {
      warn.mockRestore()
    }
  })

  // Positive case: a cursor that never reports EndReached (modelling a score
  // with more onsets than any real piece could have) must not hang the walk
  // forever, must cap the collected onsets at MAX_CURSOR_STEPS, and must warn
  // exactly once, naming the cap, so a truncated cursor is visible instead of
  // presenting as "the cursor silently stops moving partway through".
  it('caps the onset walk at 200_000 steps and warns exactly once, naming the cap, when the score never reports EndReached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const unbounded = makeUnboundedFakeCursor()
      const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
      const withCursor: OsmdLike = { ...fakeOsmd, cursor: unbounded.cursor }
      const engraver = createOsmdEngraver({ createOsmd: () => withCursor })

      await engraver.load(document.createElement('div'), '<xml/>', singleNoteScore())

      expect(warn).toHaveBeenCalledTimes(1)
      const [message] = warn.mock.calls[0] ?? []
      expect(typeof message).toBe('string')
      expect(message as string).toContain('osmdEngraver')
      expect(message as string).toContain('200000')

      // Proves onsetTicks itself was capped, not just the walk that built it:
      // `collectOnsetTicks` reset the cursor back to index 0 before returning,
      // so moving to an arbitrarily large tick from here can only ever park on
      // the LAST collected onset (index 200_000 - 1).
      //
      // But a single `moveCursorTo` call may NOT take all 199_999 steps in one
      // go — each one is a real, visible-cursor `next()` (OSMD's full
      // graphical `Cursor.update()`), so one frame issuing ~200k of them would
      // freeze the UI on the very first frame after load. `moveCursorToIndex`
      // caps each call's work (MAX_CURSOR_STEPS_PER_MOVE, well under the
      // 200_000 onset cap) and reports back the index it actually reached, so
      // the first call only makes partial progress...
      engraver.moveCursorTo(0, Number.MAX_SAFE_INTEGER)
      const afterFirstMove = unbounded.state.index
      expect(afterFirstMove).toBeGreaterThan(0)
      expect(afterFirstMove).toBeLessThan(199_999)

      // ...and subsequent frames (still targeting the same huge tick) pick up
      // from wherever the cursor actually stopped, eventually converging on
      // the last collected onset rather than getting stuck behind it forever.
      for (let i = 0; i < 199_999 / Math.max(afterFirstMove, 1) + 2; i++) {
        engraver.moveCursorTo(0, Number.MAX_SAFE_INTEGER)
        if (unbounded.state.index >= 199_999) break
      }

      expect(unbounded.state.index).toBe(199_999)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('createOsmdEngraver: click-to-select (roadmap 4.8a)', () => {
  it("stamps each mapped note's rendered SVG element with data-note-id after load", async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd(
      [measureOf(containerOf(engravedM0)), measureOf(containerOf(engravedM1a, engravedM1b))],
      gnote.GNote,
    )
    const engraver = await load(score, fakeOsmd)

    expect(gnote.elementFor(engravedM0).getAttribute('data-note-id')).toBe(m0note.id)
    expect(gnote.elementFor(engravedM1a).getAttribute('data-note-id')).toBe(m1noteA.id)
    expect(gnote.elementFor(engravedM1b).getAttribute('data-note-id')).toBe(m1noteB.id)
    // Resolving a click against the stamped element is the point of stamping
    // at all — proven properly by the `noteIdAt` tests below, but a direct
    // check here that the engraver instance agrees with what it just stamped
    // catches a stamp/read mismatch this test alone wouldn't otherwise show.
    expect(engraver.noteIdAt(gnote.elementFor(engravedM0))).toBe(m0note.id)
  })

  it('stamps each CHORD member with its own id on its own notehead, not the shared group (roadmap review finding 1)', async () => {
    // chordAndSingleScore: measure 0 is a chord (60, 64) plus a single note
    // (67) — the mapping-order test above pins that our notes zip to
    // engravedC60/engravedC64/engravedSingle in that order.
    const score = chordAndSingleScore()
    const [c60, c64, single67] = score.notes
    if (c60 === undefined || c64 === undefined || single67 === undefined) throw new Error('setup')

    const engravedC60 = note(60)
    const engravedC64 = note(64)
    const engravedSingle = note(67)
    // c60 and c64 share ONE VexFlow StaveNote/group, exactly like OSMD's real
    // chord rendering — see makeGNoteForChord's doc comment.
    const chord = makeGNoteForChord([engravedC60, engravedC64])
    // The single note gets its own independent group, as an ordinary
    // (non-chord) note would.
    const singleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const combinedGNote: FakeGNote = (n) => {
      if (n === engravedSingle) {
        return {
          setColor: () => undefined,
          getSVGGElement: () => singleGroup,
          vfnoteIndex: 0,
          getNoteheadSVGs: () => [singleGroup],
        }
      }
      return chord.GNote(n)
    }
    const fakeOsmd = makeFakeOsmd(
      [measureOf(containerOf(engravedC60, engravedC64), containerOf(engravedSingle))],
      combinedGNote,
    )
    const engraver = await load(score, fakeOsmd)

    const c60Head = chord.noteheadFor.get(engravedC60)
    const c64Head = chord.noteheadFor.get(engravedC64)
    if (c60Head === undefined || c64Head === undefined) throw new Error('setup')

    // Each chord member's OWN notehead carries its OWN id — the shared group
    // itself is never stamped with either.
    expect(c60Head.getAttribute('data-note-id')).toBe(c60.id)
    expect(c64Head.getAttribute('data-note-id')).toBe(c64.id)
    expect(chord.sharedGroup.hasAttribute('data-note-id')).toBe(false)

    // Both chord members resolve independently via noteIdAt.
    expect(engraver.noteIdAt(c60Head)).toBe(c60.id)
    expect(engraver.noteIdAt(c64Head)).toBe(c64.id)
    expect(engraver.noteIdAt(singleGroup)).toBe(single67.id)
  })

  it('re-stamps after a fallback render, since a full render discards the previous SVG tree', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    // GNote resolves fine (so stampNoteIds can always get an element), but
    // setColor throws — forcing paint() down the 'needs-render' fallback
    // without ever making the id-map itself unresolvable.
    const elements = new Map<FakeNote, SVGGElement>()
    const GNote: FakeGNote = (n) => {
      let el = elements.get(n)
      if (el === undefined) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        elements.set(n, el)
      }
      return {
        setColor: () => {
          throw new Error('setColor boom')
        },
        getSVGGElement: () => el,
        vfnoteIndex: 0,
        getNoteheadSVGs: () => [el],
      }
    }
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], GNote)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    const el = elements.get(engravedNote)
    if (el === undefined) throw new Error('setup')
    expect(el.getAttribute('data-note-id')).toBe(c60.id) // stamped once already, by load()

    // Simulate OSMD tearing the note's SVG down on the next full render: the
    // attribute this test is about to prove gets put BACK.
    el.removeAttribute('data-note-id')

    engraver.setNoteColor(c60.id, 'red') // setColor throws -> 'needs-render'
    expect(fakeOsmd.renderCount).toBe(0) // not yet flushed
    scheduler.flush()

    expect(fakeOsmd.renderCount).toBe(1)
    expect(el.getAttribute('data-note-id')).toBe(c60.id)
  })

  it('resolves a click on the notehead element itself to its note id', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    const container = document.createElement('div')
    await engraver.load(container, '<score/>', score)

    expect(engraver.noteIdAt(gnote.elementFor(engravedNote))).toBe(c60.id)
  })

  it('resolves a click on a DESCENDANT of the notehead group by walking up to it', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    const container = document.createElement('div')
    await engraver.load(container, '<score/>', score)

    const noteheadEl = gnote.elementFor(engravedNote)
    container.appendChild(noteheadEl)
    const strokeChild = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    noteheadEl.appendChild(strokeChild)

    expect(engraver.noteIdAt(strokeChild)).toBe(c60.id)
  })

  it('resolves a click that lands on the score but no notehead to undefined (the miss case)', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    const container = document.createElement('div')
    await engraver.load(container, '<score/>', score)

    const emptyStaffEl = document.createElement('div')
    container.appendChild(emptyStaffEl)

    expect(engraver.noteIdAt(emptyStaffEl)).toBeUndefined()
    expect(engraver.noteIdAt(container)).toBeUndefined()
  })

  it('never throws on a click target that is not even an Element (e.g. null, or a plain EventTarget)', async () => {
    const score = singleNoteScore()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    const engraver = await load(score, fakeOsmd)

    expect(() => engraver.noteIdAt(null)).not.toThrow()
    expect(engraver.noteIdAt(null)).toBeUndefined()
    expect(engraver.noteIdAt(new EventTarget())).toBeUndefined()
  })

  it('resolves every click to undefined before load() has ever resolved', () => {
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })

    expect(engraver.noteIdAt(document.createElement('div'))).toBeUndefined()
  })

  it('resolves every click to undefined after destroy() — a stamped element from before the destroy must not resolve', async () => {
    // The `containerEl === undefined` guard in `noteIdAt` matters specifically
    // for a STALE stamped element that survives `destroy()`: without the
    // guard, a click on that element would still walk up to its
    // `data-note-id` attribute and resolve it, even though the engraver
    // considers itself torn down. A fresh, never-appended element (as the
    // pre-load test above uses) would resolve to undefined regardless of the
    // guard, so it cannot kill this mutant on its own.
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    const container = document.createElement('div')
    await engraver.load(container, '<score/>', score)

    const stampedEl = gnote.elementFor(engravedNote)
    container.appendChild(stampedEl)
    expect(engraver.noteIdAt(stampedEl)).toBe(c60.id) // sanity: resolves before destroy

    engraver.destroy()

    expect(engraver.noteIdAt(stampedEl)).toBeUndefined()
  })

  it('renders and does not throw, and stamps no ids, when the whole score is unmappable (mismatched counts)', async () => {
    const score = twoMeasureScore()
    // Every measure declares MORE engraved notes than ours — buildNoteIdMap
    // leaves the whole map empty (see the mismatched-measure test above), so
    // stampNoteIds has nothing to iterate and GNote (which WOULD hand back a
    // real element) is never even called.
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd(
      [
        measureOf(containerOf(note(60), note(61))),
        measureOf(containerOf(note(62), note(65), note(69))),
      ],
      gnote.GNote,
    )
    const container = document.createElement('div')
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })

    await expect(engraver.load(container, '<score/>', score)).resolves.toBeUndefined()

    // Nothing was ever stamped: a click anywhere in the (empty) container misses.
    expect(engraver.noteIdAt(container)).toBeUndefined()
  })
})

// These tests drive a FAKE OSMD, so they can only prove the LABEL PLACEMENT
// LOGIC against that fake's `GraphicSheet.MeasureList`/`getVFStave()` shape —
// which measure gets which string, in what SVG position relative to the
// fake's own reported coordinates, and how replacement/resize-survival work.
// They cannot prove the numerals are legible, non-overlapping, or positioned
// sensibly against a REAL rendered score — that is only provable in a real
// browser against a real OSMD render (see the module's REPORT for what was
// and wasn't checked this way, per the "fake whose implementation does
// nothing" trap this suite's own header comment already warns about).
describe('createOsmdEngraver: setMeasureLabels (roadmap 3.18a)', () => {
  it('places a label under its own measure, keyed 1-based, positioned from the bottom staff of that measure', async () => {
    const score = twoMeasureScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
      [fakeGraphicalMeasure(fakeStave(200, 150, 50))],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    engraver.setMeasureLabels(
      new Map([
        [1, 'I'],
        [2, 'V'],
      ]),
    )

    const texts = [...svg.querySelectorAll('text')]
    expect(texts.map((t) => t.textContent)).toEqual(['I', 'V'])
    // measure 1: x = centre of [0, 200] = 100; y = bottomY(50) + offset(16) = 66.
    expect(texts[0]?.getAttribute('x')).toBe('100')
    expect(texts[0]?.getAttribute('y')).toBe('66')
    expect(texts[0]?.getAttribute('text-anchor')).toBe('middle')
    // measure 2: x = centre of [200, 350] = 275.
    expect(texts[1]?.getAttribute('x')).toBe('275')
  })

  it('leaves a measure absent from the map unlabelled — no text node for it, not a blank one', async () => {
    const score = twoMeasureScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
      [fakeGraphicalMeasure(fakeStave(200, 150, 50))],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    engraver.setMeasureLabels(new Map([[1, 'I']])) // measure 2 has no entry

    const texts = [...svg.querySelectorAll('text')]
    expect(texts.map((t) => t.textContent)).toEqual(['I'])
  })

  it('picks the BOTTOM staff of a measure with several staves — under the grand staff, not between them', async () => {
    const score = singleNoteScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      // Right-hand staff (bottomY 40) above the left-hand staff (bottomY 90)
      // — the label must anchor off the LAST entry, not the first.
      [fakeGraphicalMeasure(fakeStave(0, 200, 40)), fakeGraphicalMeasure(fakeStave(0, 200, 90))],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    engraver.setMeasureLabels(new Map([[1, 'I']]))

    const text = svg.querySelector('text')
    expect(text?.getAttribute('y')).toBe(String(90 + 16))
  })

  it('replaces previously-set labels wholesale — a second call clears what the first drew, not just adds to it', async () => {
    const score = twoMeasureScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
      [fakeGraphicalMeasure(fakeStave(200, 150, 50))],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    engraver.setMeasureLabels(
      new Map([
        [1, 'I'],
        [2, 'V'],
      ]),
    )
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['I', 'V'])

    engraver.setMeasureLabels(new Map([[1, 'IV']])) // measure 2 dropped, measure 1 relabelled

    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['IV'])
    // Exactly one label group, not one accumulated per call.
    expect(svg.querySelectorAll('g[data-measure-labels]').length).toBe(1)
  })

  it('does not schedule a render — direct SVG mutation only (roadmap 2.32)', async () => {
    const score = singleNoteScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
    ])
    const { container } = containerWithSvg()
    const scheduler = makeFakeScheduler()
    const engraver = createOsmdEngraver({
      createOsmd: () => fakeOsmd,
      scheduleRender: scheduler.scheduleRender,
    })
    await engraver.load(container, '<score/>', score)
    const renderCountAfterLoad = fakeOsmd.renderCount

    engraver.setMeasureLabels(new Map([[1, 'I']]))

    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
    expect(fakeOsmd.renderCount).toBe(renderCountAfterLoad)
  })

  it('labels set before load() resolves are applied by the first render', async () => {
    const score = singleNoteScore()
    const baseFakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
    ])
    let resolveLoad: () => void = () => undefined
    const fakeOsmd: FakeOsmd = {
      ...baseFakeOsmd,
      load: () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve
        }),
    }
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })

    const loadPromise = engraver.load(container, '<score/>', score)

    // The race: fires while `load()`'s internal `await instance.load(...)` is
    // still pending — `osmd`/`containerEl` are still unset at this point.
    engraver.setMeasureLabels(new Map([[1, 'I']]))
    expect(svg.querySelector('text')).toBeNull() // nothing to paint onto yet

    resolveLoad()
    await loadPromise

    expect(svg.querySelector('text')?.textContent).toBe('I')
  })

  it('is re-applied after a full re-render — survives the SVG tree being wiped, e.g. by autoResize (roadmap 2.32 durability)', async () => {
    const score = singleNoteScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)
    engraver.setMeasureLabels(new Map([[1, 'I']]))
    expect(svg.querySelector('text')?.textContent).toBe('I')

    // Simulate what a real `osmd.render()` does on OSMD's own initiative
    // (autoResize): discard and rebuild the entire SVG tree. This fake's
    // `render()` does not touch the DOM itself, so the wipe is done by hand —
    // the point under test is only what happens AFTER that, when the
    // (wrapped) `render()` runs again.
    while (svg.firstChild !== null) svg.removeChild(svg.firstChild)
    expect(svg.querySelector('text')).toBeNull()

    // `load()` rebound `fakeOsmd.render` to the wrapper that also re-applies
    // measure labels — calling it directly models OSMD calling its own
    // `render()` on a resize, which this file never controls.
    fakeOsmd.render()

    expect(svg.querySelector('text')?.textContent).toBe('I')
  })

  it('skips a measure whose graphical row has no bottom-staff VexFlow stave, without throwing', async () => {
    const score = singleNoteScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(undefined)],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    expect(() => engraver.setMeasureLabels(new Map([[1, 'I']]))).not.toThrow()
    expect(svg.querySelector('text')).toBeNull()
  })

  it('falls back to a higher staff in the row when the bottom staff has no VexFlow stave (roadmap-review finding 4)', async () => {
    const score = singleNoteScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 40)), fakeGraphicalMeasure(undefined)],
    ])
    const { container, svg } = containerWithSvg()
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    engraver.setMeasureLabels(new Map([[1, 'I']]))

    const text = svg.querySelector('text')
    expect(text?.textContent).toBe('I')
    expect(text?.getAttribute('y')).toBe(String(40 + 16))
  })

  it('does not throw when the container has no rendered <svg> yet', async () => {
    const score = singleNoteScore()
    const fakeOsmd = withGraphicSheet(makeFakeOsmd([measureOf(containerOf(note(60)))]), [
      [fakeGraphicalMeasure(fakeStave(0, 200, 50))],
    ])
    const container = document.createElement('div') // no <svg> child
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(container, '<score/>', score)

    expect(() => engraver.setMeasureLabels(new Map([[1, 'I']]))).not.toThrow()
  })
})

// Roadmap 5.24: colour alone (NoteheadColor/StemColor) is the worst possible
// signal pair for red-green colour vision deficiency — correct (#1c7c3c) vs
// wrong (#c22f2c) is exactly that pair. `setNoteColor` now also classifies
// the exact colour it is handed against `FEEDBACK_CORRECT_COLOR`/
// `FEEDBACK_WRONG_COLOR`/`FEEDBACK_MISSED_COLOR` and stamps the matching
// `.note-correct`/`.note-wrong`/`.note-missed` shape class (domain.css) onto
// the notehead's own rendered element — the same element `noteIdAt`/
// `stampNoteIds` already resolve, via `getNoteheadSVGs()[vfnoteIndex]`
// falling back to `getSVGGElement()`.
describe('createOsmdEngraver: feedback shape classes (roadmap 5.24)', () => {
  it('setNoteColor with the correct/wrong/missed feedback colours stamps the matching class on the notehead, on the fast SVG path with zero renders', async () => {
    const score = twoMeasureScore()
    const [m0note, m1noteA, m1noteB] = score.notes
    if (m0note === undefined || m1noteA === undefined || m1noteB === undefined) {
      throw new Error('setup')
    }
    const engravedM0 = note(60)
    const engravedM1a = note(62)
    const engravedM1b = note(65)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd(
      [measureOf(containerOf(engravedM0)), measureOf(containerOf(engravedM1a, engravedM1b))],
      gnote.GNote,
    )
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(m0note.id, FEEDBACK_CORRECT_COLOR)
    engraver.setNoteColor(m1noteA.id, FEEDBACK_WRONG_COLOR)
    engraver.setNoteColor(m1noteB.id, FEEDBACK_MISSED_COLOR)

    expect(scheduler.scheduleRender).not.toHaveBeenCalled()
    expect(gnote.elementFor(engravedM0).classList.contains('note-correct')).toBe(true)
    expect(gnote.elementFor(engravedM1a).classList.contains('note-wrong')).toBe(true)
    expect(gnote.elementFor(engravedM1b).classList.contains('note-missed')).toBe(true)
    // Each element carries exactly its own class, never another's.
    expect(gnote.elementFor(engravedM0).classList.contains('note-wrong')).toBe(false)
    expect(gnote.elementFor(engravedM0).classList.contains('note-missed')).toBe(false)
  })

  it('a colour that is not one of the three feedback colours applies no feedback class', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = await load(score, fakeOsmd)

    // An arbitrary highlight colour, as click-to-select (roadmap 4.8a) uses.
    engraver.setNoteColor(c60.id, 'red')

    const el = gnote.elementFor(engravedNote)
    expect(el.classList.contains('note-correct')).toBe(false)
    expect(el.classList.contains('note-wrong')).toBe(false)
    expect(el.classList.contains('note-missed')).toBe(false)
  })

  it('re-colouring to a different verdict swaps the class rather than accumulating both', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = await load(score, fakeOsmd)

    engraver.setNoteColor(c60.id, FEEDBACK_CORRECT_COLOR)
    const el = gnote.elementFor(engravedNote)
    expect(el.classList.contains('note-correct')).toBe(true)

    engraver.setNoteColor(c60.id, FEEDBACK_WRONG_COLOR)

    expect(el.classList.contains('note-correct')).toBe(false)
    expect(el.classList.contains('note-wrong')).toBe(true)
  })

  it('clearNoteColors strips the feedback class along with the colour', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = await load(score, fakeOsmd)

    engraver.setNoteColor(c60.id, FEEDBACK_WRONG_COLOR)
    const el = gnote.elementFor(engravedNote)
    expect(el.classList.contains('note-wrong')).toBe(true)

    engraver.clearNoteColors()

    expect(el.classList.contains('note-wrong')).toBe(false)
  })

  it('hiding a coloured note strips its feedback class (occluded, not judged); revealing restores it', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = await load(score, fakeOsmd)
    const el = gnote.elementFor(engravedNote)

    engraver.setNoteColor(c60.id, FEEDBACK_MISSED_COLOR)
    expect(el.classList.contains('note-missed')).toBe(true)

    engraver.setNoteHidden(c60.id, true)
    expect(el.classList.contains('note-missed')).toBe(false)

    engraver.setNoteHidden(c60.id, false)
    expect(el.classList.contains('note-missed')).toBe(true)
  })

  it('is re-applied after a full re-render — survives the SVG tree being wiped, e.g. by autoResize (roadmap 2.32 durability, restated for the class)', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = await load(score, fakeOsmd)
    const el = gnote.elementFor(engravedNote)

    engraver.setNoteColor(c60.id, FEEDBACK_WRONG_COLOR)
    expect(el.classList.contains('note-wrong')).toBe(true)

    // Simulate what a real `osmd.render()` does on OSMD's own initiative
    // (autoResize): the SVG tree is discarded and rebuilt, so a class set
    // directly on the old element is gone — this fake's `render()` does not
    // touch the DOM itself, so the wipe is done by hand, same technique as
    // the identical `setMeasureLabels` durability test above.
    el.classList.remove('note-wrong')
    expect(el.classList.contains('note-wrong')).toBe(false)

    // `load()` rebound `fakeOsmd.render` to the wrapper that also reapplies
    // feedback classes — calling it directly models OSMD calling its own
    // `render()` on a resize, which this file never controls.
    fakeOsmd.render()

    expect(el.classList.contains('note-wrong')).toBe(true)
  })

  it('a full re-render does not reapply a class for an id that was cleared before it', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gnote.GNote)
    const engraver = await load(score, fakeOsmd)
    const el = gnote.elementFor(engravedNote)

    engraver.setNoteColor(c60.id, FEEDBACK_CORRECT_COLOR)
    engraver.clearNoteColors()
    expect(el.classList.contains('note-correct')).toBe(false)

    fakeOsmd.render()

    expect(el.classList.contains('note-correct')).toBe(false)
  })

  it('falls back to a render and still carries the class once GNote is unavailable at colouring time', async () => {
    const score = singleNoteScore()
    const [c60] = score.notes
    if (c60 === undefined) throw new Error('setup')
    const engravedNote = note(60)
    const gnote = makeGNoteWithElements()
    // Gated rather than permanently missing: GNote resolves nothing at the
    // exact moment `setNoteColor` calls `paint()` (forcing 'needs-render'),
    // then becomes resolvable before the coalesced render fires — the same
    // shape as the existing 'needs-render fallback' tests above, without
    // reassigning `OsmdLike.rules`, which is `readonly`.
    let gNoteReady = false
    const gatedGNote: FakeGNote = (n) => (gNoteReady ? gnote.GNote(n) : undefined)
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(engravedNote))], gatedGNote)
    const scheduler = makeFakeScheduler()
    const engraver = await load(score, fakeOsmd, scheduler.scheduleRender)

    engraver.setNoteColor(c60.id, FEEDBACK_CORRECT_COLOR)
    expect(scheduler.scheduleRender).toHaveBeenCalledTimes(1)

    gNoteReady = true
    scheduler.flush()

    expect(fakeOsmd.renderCount).toBe(1)
    expect(gnote.elementFor(engravedNote).classList.contains('note-correct')).toBe(true)
  })
})
