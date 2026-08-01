/**
 * Seam tests — the gap the approach review flagged: nothing in the suite ever
 * fed a parsed `Score` to a `Transport` or a `NoteMatcher`. `parseMusicXml` and
 * `parseMidiFile` were only imported by their own test files, so a tick-rescale
 * bug (a rounding-direction error in the `<divisions>` conversion, a MIDI
 * `division` that is not honoured, …) would produce a self-consistent `Score`
 * that plays back at the wrong times while every other test — including the
 * parsers' own golden files — stayed green.
 *
 * These tests parse real bytes, then PLAY the result: drive a `Transport`
 * under a `FakeClock` and replay the parsed notes through a `NoteMatcher`, the
 * two consumers that actually turn ticks into sound and judgment. No DOM, no
 * adapters — everything here lives inside `src/core`, same as the modules
 * under test.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMidiFile } from '@core/notation/midifile.ts'
import { parseMusicXml } from '@core/notation/musicxml.ts'
import type { Score } from '@core/notation/score.ts'
import { MATCHER_DEFAULTS, NoteMatcher } from '@core/practice/matcher.ts'
import { at } from '@core/shared/invariant.ts'
import { unwrap } from '@core/shared/result.ts'
import { millis as asMillis } from '@core/shared/units.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { Transport, type TransportEvent } from '@core/timing/transport.ts'
import { FakeClock } from '@test/fakes.ts'

// ------------------------------------------------------------------ helpers

const loadFixture = (name: string): string =>
  readFileSync(new URL(`../notation/__fixtures__/${name}`, import.meta.url), 'utf8')

/** Find a note by pitch and onset, or fail loudly — better than a silent `undefined`. */
function noteFor(score: Score, midi: number, startTick: number) {
  const note = score.notes.find((n) => n.midi === midi && n.startTick === startTick)
  if (note === undefined) throw new Error(`no note midi=${midi} at tick=${startTick} in the score`)
  return note
}

const noteOnMidis = (events: readonly TransportEvent[]): number[] => {
  const out: number[] = []
  for (const e of events) if (e.type === 'noteOn') out.push(e.note.midi)
  return out
}

/**
 * Pump the transport to just past `ms`, not exactly to it. `tickToMs` and
 * `msToTick` are exact inverses only up to floating-point rounding —
 * transport.ts's own `advance()` documents ticks that come back "a few times
 * 1e-13" short of the mark — so landing exactly on a hand-computed boundary
 * can occasionally stop a hair short of the tick and miss the event by one
 * pump. `EPS_MS` is many orders of magnitude bigger than that rounding error
 * and many orders smaller than the gap between any two notes in these
 * fixtures (hundreds of ms), so it cannot pull a later note in early either.
 */
const EPS_MS = 1e-6

function pumpJustPast(
  clock: FakeClock,
  transport: Transport,
  ms: number,
): readonly TransportEvent[] {
  clock.setTime(ms + EPS_MS)
  return transport.tick()
}

// ============================================================ MusicXML seam

describe('MusicXML -> TempoMap -> Transport (mid-score divisions/key/tempo changes)', () => {
  const score = unwrap(parseMusicXml(loadFixture('mid-score-changes.musicxml')))

  /**
   * Hand arithmetic — cross-check against the fixture's own comment before
   * trusting either.
   *
   * MS_PER_TICK_AT_1_BPM = 60_000 / TICKS_PER_QUARTER = 60_000 / 480 = 125,
   * so one tick at B bpm lasts 125 / B ms.
   *
   * Bar 1  divisions=1 -> one duration unit = 480/1 = 480 ticks. Tempo is 100
   *        bpm (<sound tempo="100"/>) from tick 0: 125/100 = 1.25 ms/tick.
   *   C4 tick    0   ms    0 * 1.25 =    0
   *   D4 tick  480   ms  480 * 1.25 =  600
   *   E4 tick  960   ms  960 * 1.25 = 1200
   *   F4 tick 1440   ms 1440 * 1.25 = 1800
   *
   * Bar 2 starts at 1920 (bar 1 is a full 4/4 = 1920 ticks). Tempo changes to
   *        72 at tick 1920 — the <sound tempo="72"/> written alongside a
   *        <metronome> quarter=60 wins, because <sound> is the playback
   *        authority. Segment boundary: 1920 * 1.25 = 2400 ms (continuous
   *        with bar 1). From here, 125/72 ms/tick.
   *   D4 tick 1920   ms 2400 + (1920-1920)*125/72 = 2400
   *   E4 tick 2400   ms 2400 +  480       *125/72 = 2400 +  833.33.. = 3233.33..
   *   F#4tick 2880   ms 2400 +  960       *125/72 = 2400 + 1666.67.. = 4066.67..
   *
   * Bar 3 starts at 3360 (1920+1440: bar 2 is 3/4 = 1440 ticks, inherited by
   *        bar 3, which declares no <time> of its own). divisions changes to
   *        4 -> one duration unit = 480/4 = 120 ticks, so a
   *        <duration>4</duration> quarter note is STILL 4*120 = 480 ticks —
   *        the divisions change must not move where a quarter note lands.
   *        Tempo is unchanged (still 72, no new mark in this bar).
   *   A4 tick 3360   ms 2400 + 1440*125/72 = 2400 + 2500      = 4900
   *   B4 tick 3840   ms 2400 + 1920*125/72 = 2400 + 3333.33.. = 5733.33..
   *   C#5tick 4320   ms 2400 + 2400*125/72 = 2400 + 4166.67.. = 6566.67..
   *
   * Bar 4 starts at 4800 (3360+1440, still the inherited 3/4). The clef turns
   *        bass, so the single staff switches to the left hand; divisions
   *        stays 4.
   *   D3 tick 4800   ms 2400 + 2880*125/72 = 2400 + 5000      = 7400
   */
  const EXPECTED = [
    { midi: 60, tick: 0, ms: 0 },
    { midi: 62, tick: 480, ms: 600 },
    { midi: 64, tick: 960, ms: 1200 },
    { midi: 65, tick: 1440, ms: 1800 },
    { midi: 62, tick: 1920, ms: 2400 },
    { midi: 64, tick: 2400, ms: 2400 + (480 * 125) / 72 },
    { midi: 66, tick: 2880, ms: 2400 + (960 * 125) / 72 },
    { midi: 69, tick: 3360, ms: 2400 + (1440 * 125) / 72 },
    { midi: 71, tick: 3840, ms: 2400 + (1920 * 125) / 72 },
    { midi: 73, tick: 4320, ms: 2400 + (2400 * 125) / 72 },
    { midi: 50, tick: 4800, ms: 2400 + (2880 * 125) / 72 },
  ] as const

  it('parses to the hand-checked ticks (a stepping stone, not the point of this file)', () => {
    expect(score.notes.map((n) => [n.midi, n.startTick])).toEqual(
      EXPECTED.map((e) => [e.midi, e.tick]),
    )
  })

  it('a Transport driven by a FakeClock fires every noteOn at the hand-computed millisecond', () => {
    const tempo = makeTempoMap(score.tempos)
    const clock = new FakeClock()
    const transport = new Transport({ score, tempo, clock })
    transport.play()

    const observed: number[] = []
    for (const expected of EXPECTED) {
      observed.push(...noteOnMidis(pumpJustPast(clock, transport, expected.ms)))
    }
    // One noteOn per pump, in order: nothing fired early, nothing fired late,
    // nothing fired at all extra or missing.
    expect(observed).toEqual(EXPECTED.map((e) => e.midi))
  })

  it('negative control: halving the divisions without touching <duration> moves the note', () => {
    // The same two-quarter-note measure, written twice: divisions 4 then 2,
    // <duration> left at 4 both times — the exact perturbation bar 3 of the
    // fixture above guards against (a <duration> re-read against the wrong
    // divisions). If a rescale bug ignored `divisions` (or rounded it away),
    // these two documents would parse to the SAME ticks and this test would
    // pass no matter what — which is exactly the silent failure this file
    // exists to rule out for the real fixture above.
    const twoQuarterNotes = (divisions: number): string => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions>
  <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  </measure></part></score-partwise>`

    const correct = unwrap(parseMusicXml(twoQuarterNotes(4)))
    const halved = unwrap(parseMusicXml(twoQuarterNotes(2)))
    const d4correct = noteFor(correct, 62, 480)
    // Halving divisions doubles the tick value of the same <duration>: the
    // second note lands at 960, not 480.
    const d4halved = noteFor(halved, 62, 960)
    expect(d4correct.startTick).toBe(480)
    expect(d4halved.startTick).toBe(960)

    const msCorrect = tickToMs(makeTempoMap(correct.tempos), d4correct.startTick)
    const msHalved = tickToMs(makeTempoMap(halved.tempos), d4halved.startTick)
    // 480 vs 960 ticks at the 120 bpm default is 500 ms apart — nowhere near
    // any tolerance a real Transport or NoteMatcher would forgive.
    expect(msHalved - msCorrect).toBeCloseTo(500, 6)
  })
})

// ================================================================= SMF seam

describe('SMF -> TempoMap -> Transport (division-independent rescale)', () => {
  // Minimal Standard MIDI File byte builder, independent of `midifile.ts`'s
  // own writer — a bug shared by both would not be caught if this reused it.
  const MTHD_TAG = [0x4d, 0x54, 0x68, 0x64]
  const MTRK_TAG = [0x4d, 0x54, 0x72, 0x6b]

  function vlq(value: number): number[] {
    const bytes = [value & 0x7f]
    let rest = Math.floor(value / 0x80)
    while (rest > 0) {
      bytes.unshift((rest & 0x7f) | 0x80)
      rest = Math.floor(rest / 0x80)
    }
    return bytes
  }

  function chunkBytes(tag: readonly number[], body: readonly number[]): number[] {
    const n = body.length
    return [...tag, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...body]
  }

  /** `[deltaTicks, ...statusAndData]`. */
  type Ev = readonly number[]
  const on = (delta: number, note: number): Ev => [delta, 0x90, note, 80]
  const off = (delta: number, note: number): Ev => [delta, 0x80, note, 0x40]
  const tempoMeta = (delta: number, micros: number): Ev => [
    delta,
    0xff,
    0x51,
    3,
    (micros >> 16) & 0xff,
    (micros >> 8) & 0xff,
    micros & 0xff,
  ]

  function smfFile(division: number, events: readonly Ev[]): Uint8Array {
    const header = chunkBytes(MTHD_TAG, [0, 1, 0, 1, (division >> 8) & 0xff, division & 0xff])
    const body: number[] = []
    for (const e of events) {
      const [delta = 0, ...rest] = e
      body.push(...vlq(delta), ...rest)
    }
    body.push(...vlq(0), 0xff, 0x2f, 0x00) // end of track
    return Uint8Array.from([...header, ...chunkBytes(MTRK_TAG, body)])
  }

  // 96 bpm (625,000 µs/quarter, EXACT: 60_000_000 / 96 = 625_000) then 125
  // bpm (480,000 µs/quarter, EXACT: 60_000_000 / 125 = 480_000) from the
  // third note. Chosen so every hand-computed millisecond below is a whole
  // number — no repeating decimals to eyeball.
  const BPM_A_MICROS = 625_000
  const BPM_B_MICROS = 480_000

  /**
   * One quarter note is `division` raw ticks, by definition of `division` —
   * so the same four notes, written at any division, describe the same music.
   * `parseMidiFile` rescales with `round(tick * 480 / division)`, and every
   * onset here is an exact multiple of `division`, so the rescale is exact
   * (`round(k * division * 480 / division) === k * 480`) whatever `division`
   * is — which is the property test 2 exists to pin.
   */
  function buildFile(division: number): Uint8Array {
    return smfFile(division, [
      tempoMeta(0, BPM_A_MICROS),
      on(0, 60),
      off(division, 60),
      on(0, 62),
      off(division, 62),
      tempoMeta(0, BPM_B_MICROS), // lands exactly on E4's onset, 2 quarters in
      on(0, 64),
      off(division, 64),
      on(0, 65),
      off(division, 65),
    ])
  }

  /**
   * Hand arithmetic. Internal ticks (after rescale, any division): C4=0,
   * D4=480, E4=960, F4=1440 — see `buildFile`'s doc comment for why the
   * rescale is exact.
   *   C4 tick   0  ms 0
   *   D4 tick 480  ms  480 * 125/96             =  60000/96   =  625
   *   E4 tick 960  ms  960 * 125/96 (bpm boundary) = 120000/96 = 1250
   *   F4 tick1440  ms 1250 + 480*125/125         = 1250 + 480  = 1730
   */
  const EXPECTED = [
    { midi: 60, ms: 0 },
    { midi: 62, ms: 625 },
    { midi: 64, ms: 1250 },
    { midi: 65, ms: 1730 },
  ] as const

  it.each([96, 960] as const)(
    'division=%i rescales to the same 480-ticks-per-quarter timeline',
    (division) => {
      const score = unwrap(parseMidiFile(buildFile(division)))
      const tempo = makeTempoMap(score.tempos)
      const clock = new FakeClock()
      const transport = new Transport({ score, tempo, clock })
      transport.play()

      const observed: number[] = []
      for (const expected of EXPECTED) {
        observed.push(...noteOnMidis(pumpJustPast(clock, transport, expected.ms)))
      }
      expect(observed).toEqual(EXPECTED.map((e) => e.midi))
    },
  )

  it('96 and 960 ticks-per-quarter parse to identical internal ticks', () => {
    const ticksOf = (s: Score): (readonly [number, number])[] =>
      s.notes.map((n) => [n.midi, n.startTick] as const)
    expect(ticksOf(unwrap(parseMidiFile(buildFile(96))))).toEqual(
      ticksOf(unwrap(parseMidiFile(buildFile(960)))),
    )
  })

  it('negative control: a division the reader does not honour gives the wrong timing', () => {
    // The division=96 file's bytes, with the header LYING that it is
    // division=960 — the byte pattern an un-rescaled ("forgot to read
    // division") reader would leave behind. MThd is 14 bytes: tag(4)
    // length(4) format(2) ntrks(2) division(2), so the division field is the
    // last two bytes of the header.
    const lying = Uint8Array.from(buildFile(96))
    lying[12] = (960 >> 8) & 0xff
    lying[13] = 960 & 0xff

    const score = unwrap(parseMidiFile(lying))
    // 96 raw ticks (one quarter, written for division 96) read against a
    // claimed division of 960: round(96 * 480 / 960) = round(48) = 48.
    const d4 = noteFor(score, 62, 48)
    const ms = tickToMs(makeTempoMap(score.tempos), d4.startTick)
    // Correctly-scaled D4 lands at 625 ms (see EXPECTED above); misreading
    // the division compresses the whole piece 10x, so it lands nowhere near
    // that — proving the "identical timing regardless of division" property
    // above is not vacuously true.
    expect(ms).toBeLessThan(100)
  })
})

// ========================================================= matcher agreement

describe('parser -> tempo map -> matcher agreement', () => {
  const score = unwrap(parseMusicXml(loadFixture('mid-score-changes.musicxml')))

  it.each([1, 0.5] as const)(
    "replaying the score's own notes at the tempo-map-derived times scores 1.0 at scale %s",
    (scale) => {
      const tempo = makeTempoMap(score.tempos, scale)
      const matcher = new NoteMatcher(score, tempo)
      for (const note of score.notes) {
        const onsetMs = tickToMs(tempo, note.startTick)
        matcher.noteOn(note.midi, onsetMs)
        matcher.noteOff(note.midi, asMillis(onsetMs + 10))
      }
      const last = at(score.notes, score.notes.length - 1)
      const flushAt = tickToMs(tempo, last.startTick) + MATCHER_DEFAULTS.toleranceMs + 1
      matcher.advanceTo(asMillis(flushAt))

      expect(matcher.summary()).toEqual({
        correct: score.notes.length,
        wrongPitch: 0,
        missed: 0,
        extra: 0,
        accuracy: 1,
        meanAbsDeviationMs: 0,
      })
    },
  )

  it('negative control: a press shifted past the tolerance window is not scored perfect', () => {
    const tempo = makeTempoMap(score.tempos)
    const matcher = new NoteMatcher(score, tempo)
    const shifted = noteFor(score, 62, 1920) // the D4 that opens bar 2
    const shiftMs = MATCHER_DEFAULTS.toleranceMs + 50 // safely outside ±tolerance

    for (const note of score.notes) {
      const onsetMs = tickToMs(tempo, note.startTick)
      const playedAt = note.id === shifted.id ? asMillis(onsetMs + shiftMs) : onsetMs
      matcher.noteOn(note.midi, playedAt)
      matcher.noteOff(note.midi, asMillis(playedAt + 10))
    }
    const last = at(score.notes, score.notes.length - 1)
    const flushAt = tickToMs(tempo, last.startTick) + MATCHER_DEFAULTS.toleranceMs + shiftMs + 10
    matcher.advanceTo(asMillis(flushAt))

    const summary = matcher.summary()
    // The unshifted D4 window closes unplayed (missed); the late press lands
    // outside every pending note's window and is charged as extra instead of
    // being credited — a broken parser/tempo-map/matcher seam would instead
    // show this as accuracy 1, same as the test above.
    expect(summary.missed).toBeGreaterThanOrEqual(1)
    expect(summary.extra).toBeGreaterThanOrEqual(1)
    expect(summary.accuracy).toBeLessThan(1)
  })
})
