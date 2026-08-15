/**
 * The engraver's *lifecycle*: what happens around a load rather than inside
 * one. Three behaviours, all added in the 2026-08-15 performance round, all of
 * them invisible to `osmdEngraver.test.ts` because they only show up when a
 * load is interrupted, a window is resized, or the same score is loaded twice:
 *
 * 1. `destroy()` while `load()` is still awaiting — React StrictMode does this
 *    on every mount in development — must abandon the engrave, not finish it.
 * 2. The width watcher that replaced OSMD's `autoResize` re-engraves on a real
 *    width change and on nothing else.
 * 3. The engraving cache hands a big score's finished engraving to the next
 *    mount instead of re-parsing and re-laying-out.
 *
 * Same fake-OSMD approach as the behaviour suite (`osmdEngraverFakes.ts`):
 * real OSMD cannot run in happy-dom, and none of the above is OSMD's logic.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOsmdEngraver } from './osmdEngraver.ts'
import { DEFAULT_NOTE_COLOR } from './osmdSvg.ts'
import { MIN_CACHEABLE_NOTES, clearEngravingCache } from './engravingCache.ts'
import {
  containerOf,
  makeFakeOsmd,
  makeFakeScheduler,
  makeGNoteRecording,
  measureOf,
  note,
  singleNoteScore,
  type FakeMeasure,
  type FakeOsmd,
} from './osmdEngraverFakes.ts'

/** Notes per measure in the generated scores below — 4 quarter notes in 4/4. */
const NOTES_PER_MEASURE = 4

/**
 * A score with `measureCount * 4` notes, one note per vertical position, and
 * the matching fake OSMD measure list — the two are generated together so
 * `buildNoteIdMap`'s per-measure count check passes and every id maps.
 */
function generatedScore(id: string, measureCount: number): { score: Score; measures: FakeMeasure[] } {
  const notes: { midi: number; startTick: number; durationTicks: number; hand: 'right' }[] = []
  const measures: FakeMeasure[] = []
  for (let m = 0; m < measureCount; m++) {
    const fakeNotes = []
    for (let k = 0; k < NOTES_PER_MEASURE; k++) {
      const midi = 60 + ((m + k) % 12)
      notes.push({ midi, startTick: m * 1920 + k * 480, durationTicks: 480, hand: 'right' })
      fakeNotes.push(containerOf(note(midi)))
    }
    measures.push(measureOf(...fakeNotes))
  }
  return {
    score: makeScore({ id, measures: Array.from({ length: measureCount }, () => ({})), notes }),
    measures,
  }
}

/** A score big enough to be worth caching, and one below the threshold. */
function bigScore(id = 'big'): { score: Score; measures: FakeMeasure[] } {
  return generatedScore(id, MIN_CACHEABLE_NOTES / NOTES_PER_MEASURE)
}
function smallScore(id = 'small'): { score: Score; measures: FakeMeasure[] } {
  return generatedScore(id, 1)
}

/** A container whose `clientWidth` is readable and settable — happy-dom lays
 *  nothing out, so every element reports 0 forever without this. */
function containerOfWidth(width: number): { el: HTMLElement; setWidth(next: number): void } {
  const el = document.createElement('div')
  let current = width
  Object.defineProperty(el, 'clientWidth', { get: () => current, configurable: true })
  return { el, setWidth: (next) => (current = next) }
}

describe('createOsmdEngraver: destroy during an in-flight load', () => {
  it('abandons the engrave and clears the instance the aborted load created', async () => {
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    let releaseLoad = (): void => undefined
    fakeOsmd.load = () =>
      new Promise<void>((resolve) => {
        releaseLoad = resolve
      })

    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    const container = document.createElement('div')
    const loading = engraver.load(container, '<score/>', singleNoteScore())

    // The viewer unmounts while the parse is still in flight — StrictMode's
    // second effect invocation, or a fast nav away.
    engraver.destroy()
    releaseLoad()
    await loading

    expect(fakeOsmd.renderCount).toBe(0)
    // Cleared even though `destroy()` ran before `osmd` was ever assigned —
    // the bug this guards against leaked the whole instance instead.
    expect(fakeOsmd.cleared).toBe(true)
    expect(container.children).toHaveLength(0)
  })

  it('engraves exactly once for an ordinary, uninterrupted load', async () => {
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    const engraver = createOsmdEngraver({ createOsmd: () => fakeOsmd })
    await engraver.load(document.createElement('div'), '<score/>', singleNoteScore())

    // One engrave per load. Two was the pre-fix cost of OSMD's `autoResize`
    // kicking `renderAndScrollBack()` a millisecond after construction.
    expect(fakeOsmd.renderCount).toBe(1)
  })
})

describe('createOsmdEngraver: width watcher (replaces OSMD autoResize)', () => {
  const listeners: (() => void)[] = []
  let engravers: { destroy(): void }[] = []

  beforeEach(() => {
    engravers = []
  })
  afterEach(() => {
    for (const e of engravers) e.destroy()
    listeners.length = 0
  })

  /** Loads a score into a width-controlled container, with a manual scheduler
   *  and manual timers so the 200ms resize debounce is stepped, not waited on. */
  async function loadWithWidth(width: number): Promise<{
    fakeOsmd: FakeOsmd
    setWidth(next: number): void
    flushRender(): void
    engraver: { destroy(): void }
  }> {
    const fakeOsmd = makeFakeOsmd([measureOf(containerOf(note(60)))])
    const scheduler = makeFakeScheduler()
    const engraver = createOsmdEngraver({
      createOsmd: () => fakeOsmd,
      scheduleRender: scheduler.scheduleRender,
    })
    engravers.push(engraver)
    const { el, setWidth } = containerOfWidth(width)
    await engraver.load(el, '<score/>', singleNoteScore())
    fakeOsmd.renderCount = 0
    return { fakeOsmd, setWidth, flushRender: scheduler.flush, engraver }
  }

  /** Fires the debounce the width watcher installed, without real time. */
  async function settleResize(): Promise<void> {
    window.dispatchEvent(new Event('resize'))
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  it('re-engraves once when the container really changes width', async () => {
    const { fakeOsmd, setWidth, flushRender } = await loadWithWidth(800)
    setWidth(500)
    await settleResize()
    flushRender()
    expect(fakeOsmd.renderCount).toBe(1)
  })

  it('does not re-engrave when the resize left the width unchanged', async () => {
    const { fakeOsmd, flushRender } = await loadWithWidth(800)
    // A height-only drag, or a resize event on some unrelated axis: OSMD's own
    // autoResize re-engraved for these too, at half a second each.
    await settleResize()
    flushRender()
    expect(fakeOsmd.renderCount).toBe(0)
  })

  it('collapses a burst of resize events into one re-engrave', async () => {
    const { fakeOsmd, setWidth, flushRender } = await loadWithWidth(800)
    setWidth(700)
    window.dispatchEvent(new Event('resize'))
    setWidth(600)
    window.dispatchEvent(new Event('resize'))
    setWidth(500)
    await settleResize()
    flushRender()
    expect(fakeOsmd.renderCount).toBe(1)
  })

  it('stops watching after destroy()', async () => {
    const { fakeOsmd, setWidth, flushRender, engraver } = await loadWithWidth(800)
    engraver.destroy()
    setWidth(500)
    await settleResize()
    flushRender()
    expect(fakeOsmd.renderCount).toBe(0)
  })
})

describe('createOsmdEngraver: engraving cache', () => {
  beforeEach(clearEngravingCache)
  afterEach(clearEngravingCache)

  it('re-attaches a big score’s engraving on the next mount instead of engraving again', async () => {
    const { score, measures } = bigScore()
    const fakeOsmd = makeFakeOsmd(measures)
    const createOsmd = () => fakeOsmd

    const first = createOsmdEngraver({ createOsmd })
    const containerA = document.createElement('div')
    await first.load(containerA, '<score/>', score)
    expect(fakeOsmd.renderCount).toBe(1)
    expect(containerA.children).toHaveLength(1)
    first.destroy()
    // Detached from the old container, not thrown away.
    expect(containerA.children).toHaveLength(0)
    expect(fakeOsmd.cleared).toBe(false)

    const second = createOsmdEngraver({ createOsmd })
    const containerB = document.createElement('div')
    await second.load(containerB, '<score/>', score)

    expect(fakeOsmd.renderCount).toBe(1)
    expect(containerB.children).toHaveLength(1)
    second.destroy()
  })

  it('does not cache a score below the note threshold', async () => {
    const { score, measures } = smallScore()
    const fakeOsmd = makeFakeOsmd(measures)
    const createOsmd = () => fakeOsmd

    const first = createOsmdEngraver({ createOsmd })
    await first.load(document.createElement('div'), '<score/>', score)
    first.destroy()
    // Not cached, so `destroy()` disposed of it properly.
    expect(fakeOsmd.cleared).toBe(true)

    const second = createOsmdEngraver({ createOsmd })
    await second.load(document.createElement('div'), '<score/>', score)
    expect(fakeOsmd.renderCount).toBe(2)
    second.destroy()
  })

  it('never hands a live engraver’s engraving to a second one', async () => {
    const { score, measures } = bigScore()
    const fakeA = makeFakeOsmd(measures)
    const fakeB = makeFakeOsmd(measures)
    const instances = [fakeA, fakeB]

    const first = createOsmdEngraver({ createOsmd: () => instances.shift() ?? fakeB })
    await first.load(document.createElement('div'), '<score/>', score)

    // `first` is still mounted — two viewers of the same score must not share
    // one SVG and one cursor.
    const second = createOsmdEngraver({ createOsmd: () => instances.shift() ?? fakeB })
    await second.load(document.createElement('div'), '<score/>', score)

    expect(fakeA.renderCount).toBe(1)
    expect(fakeB.renderCount).toBe(1)
    first.destroy()
    second.destroy()
  })

  it('does not reuse an engraving built for a different Score', async () => {
    const a = bigScore('a')
    const b = bigScore('b')
    const fakeA = makeFakeOsmd(a.measures)
    const fakeB = makeFakeOsmd(b.measures)

    const first = createOsmdEngraver({ createOsmd: () => fakeA })
    await first.load(document.createElement('div'), '<score/>', a.score)
    first.destroy()

    // Same MusicXML string (the cache key), a different `Score` object — its
    // `ScoreNote.id`s differ, so the cached id map would be wrong.
    const second = createOsmdEngraver({ createOsmd: () => fakeB })
    await second.load(document.createElement('div'), '<score/>', b.score)
    expect(fakeB.renderCount).toBe(1)
    second.destroy()
  })

  it('resets the previous owner’s colours when the engraving is adopted', async () => {
    const { score, measures } = bigScore()
    const { GNote, calls } = makeGNoteRecording()
    const fakeOsmd = makeFakeOsmd(measures, GNote)
    const createOsmd = () => fakeOsmd
    const firstNoteId = score.notes[0]?.id ?? ''

    const first = createOsmdEngraver({ createOsmd })
    await first.load(document.createElement('div'), '<score/>', score)
    first.setNoteColor(firstNoteId, '#ff0000')
    expect(calls.at(-1)?.color).toBe('#ff0000')
    first.destroy()

    // A freshly mounted viewer expects a clean sheet, and the SVG it adopts
    // still has the red notehead painted on it.
    const second = createOsmdEngraver({ createOsmd })
    await second.load(document.createElement('div'), '<score/>', score)
    expect(calls.at(-1)?.color).toBe(DEFAULT_NOTE_COLOR)
    second.destroy()
  })
})
