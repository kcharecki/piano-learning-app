/**
 * Fakes shared by the `osmdEngraver.ts` test files. Real OSMD cannot run in
 * happy-dom (see `osmdEngraver.test.ts`'s module comment), so every test in
 * this directory drives the engraver through its `createOsmd` injection seam
 * with the structural fakes below. They live in their own module because the
 * two suites that need them — the behaviour suite and the lifecycle/cache
 * suite — would otherwise each carry a copy, and because a 400-line fake
 * preamble inside a test file pushes it past the `max-lines` budget.
 *
 * Not a test file itself: it declares no `describe`/`it`, so it is only ever
 * pulled in as an import of the specs that use it.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { createOsmdEngraver, type ScoreEngraverWithMeasureLabels } from '@app/score/osmdEngraver.ts'
import { DEFAULT_NOTE_COLOR, type OsmdLike } from '@app/score/osmdSvg.ts'

// ---------------------------------------------------------------- fake OSMD

/**
 * The exact note shape `osmdEngraver.ts` reads/writes: halfTone, isRest(),
 * NoteheadColor, and ParentVoiceEntry.StemColor (the stem-recolouring fix —
 * see the `EngravedNote` doc comment in osmdEngraver.ts).
 */
export type FakeNote = {
  halfTone: number
  isRest(): boolean
  NoteheadColor: string
  ParentVoiceEntry: { StemColor: string }
}

export function note(halfTone: number, color = DEFAULT_NOTE_COLOR): FakeNote {
  return {
    halfTone,
    isRest: () => false,
    NoteheadColor: color,
    ParentVoiceEntry: { StemColor: color },
  }
}
export function rest(): FakeNote {
  return {
    halfTone: 0,
    isRest: () => true,
    NoteheadColor: DEFAULT_NOTE_COLOR,
    ParentVoiceEntry: { StemColor: DEFAULT_NOTE_COLOR },
  }
}

/** One `VerticalSourceStaffEntryContainer`: notes spread across staves/voices at one tick. */
export type FakeContainer = {
  readonly StaffEntries: ({ readonly VoiceEntries: { readonly Notes: FakeNote[] }[] } | undefined)[]
}

/** Wraps a flat list of `FakeNote`s, each in its own staff/voice, into one container. */
export function containerOf(...notes: FakeNote[]): FakeContainer {
  return { StaffEntries: notes.map((n) => ({ VoiceEntries: [{ Notes: [n] }] })) }
}

/**
 * A container where some staves have NO entry at this vertical tick at all —
 * OSMD leaves that `StaffEntries` slot `undefined` rather than an entry with
 * an empty/rest voice, e.g. one hand sounds a note while the other rests.
 * `null` in `slots` models that gap; a `FakeNote` models a real entry.
 */
export function sparseContainerOf(...slots: (FakeNote | undefined)[]): FakeContainer {
  return {
    StaffEntries: slots.map((n) => (n === undefined ? undefined : { VoiceEntries: [{ Notes: [n] }] })),
  }
}

export type FakeMeasure = { readonly VerticalSourceStaffEntryContainers: readonly FakeContainer[] }

export function measureOf(...containers: FakeContainer[]): FakeMeasure {
  return { VerticalSourceStaffEntryContainers: containers }
}

export type FakeOsmd = OsmdLike & {
  renderCount: number
  cleared: boolean
}

/**
 * Mirrors the internal `OsmdColoringOptions`/`OsmdGraphicalNote` structural
 * types in osmdEngraver.ts (not exported — this file cannot import them, so
 * it pins the same shape independently). `getSVGGElement` is the same access
 * path `setColor` uses — see the doc comment on `OsmdGraphicalNote`.
 */
export type FakeColoringOptions = { readonly applyToNoteheads: boolean; readonly applyToStem: boolean }
export type FakeGraphicalNote = {
  setColor(color: string, options: FakeColoringOptions): void
  getSVGGElement(): SVGGElement
  readonly vfnoteIndex: number
  getNoteheadSVGs(): readonly Element[]
}
export type FakeGNote = (note: FakeNote) => FakeGraphicalNote | undefined

/** A `setColor` call the fast SVG path made, recorded verbatim. */
export type RecordedSetColor = { readonly color: string; readonly options: FakeColoringOptions }

/**
 * `GNote` fixture matching the `'painted'` path: every note maps to a
 * recording graphical-note stub, so the perf test can assert both the colour
 * AND the exact `ColoringOptions` shape (`applyToNoteheads`/`applyToStem`
 * only, nothing else) a future change might accidentally widen or narrow.
 */
export function makeGNoteRecording(): { readonly GNote: FakeGNote; readonly calls: RecordedSetColor[] } {
  const calls: RecordedSetColor[] = []
  return {
    GNote: () => ({
      setColor(color, options) {
        calls.push({ color, options })
      },
      getSVGGElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'g'),
      vfnoteIndex: 0,
      getNoteheadSVGs: () => [],
    }),
    calls,
  }
}

/**
 * A `GNote` fixture that hands back one real (detached) `SVGGElement` per note
 * — for `data-note-id` stamping tests, where the point is to read the
 * attribute back off a specific note's element (`elementFor`). Each note gets
 * its own group AND its own notehead element, `getNoteheadSVGs()[0]` — i.e.
 * every note behaves as if it were the sole member of its own chord, which is
 * the ordinary (non-chord) case `stampNoteIds` falls back correctly for.
 */
export function makeGNoteWithElements(): { readonly GNote: FakeGNote; elementFor(n: FakeNote): SVGGElement } {
  const elements = new Map<FakeNote, SVGGElement>()
  const GNote: FakeGNote = (n) => {
    let el = elements.get(n)
    if (el === undefined) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      elements.set(n, el)
    }
    return {
      setColor: () => undefined,
      getSVGGElement: () => el,
      vfnoteIndex: 0,
      getNoteheadSVGs: () => [el],
    }
  }
  return {
    GNote,
    elementFor(n) {
      const el = elements.get(n)
      if (el === undefined) throw new Error('no element for note — GNote was never called for it')
      return el
    },
  }
}

/**
 * A `GNote` fixture modelling what OSMD actually does for a CHORD: every note
 * passed to `chordNotes` shares ONE `getSVGGElement()` group (`sharedGroup`),
 * but each has its OWN notehead child element at its own `vfnoteIndex` — the
 * exact shape roadmap-review finding 1 exists to fix (`getSVGGElement()`
 * alone would let the last-stamped chord member overwrite every other
 * member's id on the shared group).
 */
export function makeGNoteForChord(chordNotes: readonly FakeNote[]): {
  readonly GNote: FakeGNote
  readonly sharedGroup: SVGGElement
  readonly noteheadFor: Map<FakeNote, SVGGElement>
} {
  const sharedGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const noteheads = chordNotes.map(() => document.createElementNS('http://www.w3.org/2000/svg', 'g'))
  const noteheadFor = new Map<FakeNote, SVGGElement>()
  chordNotes.forEach((n, i) => {
    const head = noteheads[i]
    if (head !== undefined) noteheadFor.set(n, head)
  })
  const GNote: FakeGNote = (n) => {
    const index = chordNotes.indexOf(n)
    if (index === -1) return undefined
    return {
      setColor: () => undefined,
      getSVGGElement: () => sharedGroup,
      vfnoteIndex: index,
      getNoteheadSVGs: () => noteheads,
    }
  }
  return { GNote, sharedGroup, noteheadFor }
}

/** `GNote` fixture matching the `'needs-render'` fallback path: no graphical note is ever resolvable. */
export function gNoteMissing(): FakeGraphicalNote | undefined {
  return undefined
}

/** `GNote` fixture matching the `'needs-render'` fallback path via a thrown error rather than `undefined`. */
export function gNoteThrowing(): FakeGraphicalNote {
  throw new Error('GNote boom')
}

export function makeFakeOsmd(measures: readonly FakeMeasure[], GNote: FakeGNote = gNoteMissing): FakeOsmd {
  return {
    Sheet: { SourceMeasures: measures },
    // Empty by default: the id/colour/cursor tests above never read this —
    // only `setMeasureLabels` tests do, and they build their own
    // `GraphicSheet` via `withGraphicSheet` below.
    GraphicSheet: { MeasureList: [] },
    cursor: {
      iterator: { EndReached: true, CurrentSourceTimestamp: { RealValue: 0 } },
      reset: () => undefined,
      next: () => undefined,
      nextMeasure: () => undefined,
      update: () => undefined,
      show: () => undefined,
    },
    rules: { GNote },
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

// ------------------------------------------------------- setMeasureLabels fakes

/** A fake VexFlow `Stave` — the slice `applyMeasureLabels` reads (see `OsmdVexStave`). */
export function fakeStave(x: number, width: number, bottomY: number): { getX(): number; getWidth(): number; getBottomY(): number } {
  return { getX: () => x, getWidth: () => width, getBottomY: () => bottomY }
}

/** One staff's entry in a `GraphicSheet.MeasureList` row. `stave === undefined`
 *  models a graphical measure whose `getVFStave()` has nothing to offer. */
export function fakeGraphicalMeasure(stave: ReturnType<typeof fakeStave> | undefined): {
  getVFStave(): ReturnType<typeof fakeStave> | undefined
} {
  return { getVFStave: () => stave }
}

/** `fakeOsmd` with its `GraphicSheet.MeasureList` replaced — the id/colour fakes
 *  above never populate this, so `setMeasureLabels` tests build their own. */
export function withGraphicSheet(
  fakeOsmd: FakeOsmd,
  measureList: readonly (readonly ReturnType<typeof fakeGraphicalMeasure>[])[],
): FakeOsmd {
  return { ...fakeOsmd, GraphicSheet: { MeasureList: measureList } }
}

/** A `<div>` with a real (detached) `<svg>` child already inside it — models
 *  the container after OSMD's real first render, which `applyMeasureLabels`
 *  requires (`container.querySelector('svg')`) but these fakes' `render()`
 *  never actually creates. */
export function containerWithSvg(): { readonly container: HTMLElement; readonly svg: SVGSVGElement } {
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement
  container.appendChild(svg)
  return { container, svg }
}

/**
 * A cursor double that walks a fixed list of onset ticks, counting every call.
 * `load()` walks it once to cache the onsets, so the counters are zeroed after
 * that and every later number is per-frame cursor work — which is exactly what
 * the two bugs reported from the running app were made of.
 */
export function makeFakeCursor(onsetTicks: readonly number[]): {
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

/**
 * A cursor double whose `EndReached` is ALWAYS false and whose per-step work
 * is pure arithmetic on an index — no backing array, no per-step allocation
 * — so a walk of hundreds of thousands of steps (as the `MAX_CURSOR_STEPS`
 * cap test below needs, to prove the walk stops instead of hanging forever
 * against a cursor that genuinely never ends) stays cheap: O(1) time and
 * memory per `next()`.
 */
export function makeUnboundedFakeCursor(): { readonly cursor: OsmdLike['cursor']; state: { index: number } } {
  const state = { index: 0 }
  return {
    state,
    cursor: {
      iterator: {
        // Bounded just above MAX_CURSOR_STEPS (200_000), not literally
        // forever: a cursor whose EndReached NEVER flips turns the obvious
        // mutant on the walk's cap guard (deleting
        // `onsetTicks.length < MAX_CURSOR_STEPS`) into an infinite
        // synchronous loop, which hangs the whole vitest worker instead of
        // failing the assertion below — the weakest possible signal for the
        // regression this test exists to catch. With the bound here, the
        // same mutant instead produces a clean, fast assertion failure (no
        // warn call, walk parks past 200_000).
        get EndReached() {
          return state.index >= 200_010
        },
        CurrentSourceTimestamp: {
          // OSMD reports whole notes; the engraver multiplies by 4 * TPQ.
          get RealValue() {
            return state.index / (4 * 480)
          },
        },
      },
      reset: () => {
        state.index = 0
      },
      next: () => {
        state.index += 1
      },
      nextMeasure: () => {
        state.index += 1
      },
      update: () => undefined,
      show: () => undefined,
    },
  }
}

/** A `scheduleRender` double that captures each pending flush instead of running it. */
export function makeFakeScheduler(): {
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
export function chordAndSingleScore(): Score {
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
export function twoMeasureScore(): Score {
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
export function singleNoteScore(): Score {
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
export async function load(
  score: Score,
  fakeOsmd: FakeOsmd,
  scheduleRender?: (run: () => void) => void,
): Promise<ScoreEngraverWithMeasureLabels> {
  const engraver = createOsmdEngraver({
    createOsmd: () => fakeOsmd,
    ...(scheduleRender === undefined ? {} : { scheduleRender }),
  })
  await engraver.load(document.createElement('div'), '<score/>', score)
  fakeOsmd.renderCount = 0
  return engraver
}
