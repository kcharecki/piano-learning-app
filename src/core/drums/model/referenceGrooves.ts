/**
 * Three bundled reference grooves (DR-04) — the fixtures the MusicXML bridge's
 * round-trip proof runs against (`musicxml/roundTrip.test.ts`), and useful
 * example content for DR-09/DR-13 later. Built programmatically via
 * `makeGrooveScore` rather than hand-typed as static `.musicxml` fixtures:
 * hand-typed XML is exactly the kind of fixture that silently drifts from
 * what the writer actually emits, whereas a builder function is the same
 * kind of source-of-truth the tests already trust for everything else here.
 *
 * All three sit on a 4/4, 8th- or 16th-note grid on purpose (see
 * `musicxml/roundTrip.test.ts`'s extra `scoreToGrid` sanity check) — that is
 * a property of these three examples, not a constraint `GrooveScore` itself
 * imposes.
 */
import { makeGrooveScore, type GrooveScore } from './groove.ts'

/**
 * `moneyBeat` with the hi-hat halved to quarter notes — the same backbeat and
 * the same kick, one stroke per beat instead of two. This is the groove a
 * beginner meets first (Rockschool Debut works up to the eighth-note hat from
 * here), and it is the trainer's default pick for that reason: every limb
 * lands on a beat, so nothing has to be counted between beats.
 *
 * It is also the widest-windowed groove the trainer has. Its smallest notated
 * gap is a quarter, so `planGrooveRun`'s window is the full stated tolerance
 * at any sane tempo — see `@core/drums/practice/plan.ts`.
 */
export function quarterNoteRock(): GrooveScore {
  const hihatTicks = [0, 480, 960, 1440]
  return makeGrooveScore({
    id: 'quarter-note-rock',
    title: 'Quarter-Note Rock',
    measureCount: 1,
    notes: [
      ...hihatTicks.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 480 })),
      { pad: 'kick' as const, tick: 0, durationTicks: 480 },
      { pad: 'kick' as const, tick: 960, durationTicks: 480 },
      { pad: 'snare' as const, tick: 480, durationTicks: 480 },
      { pad: 'snare' as const, tick: 1440, durationTicks: 480 },
    ],
  })
}

/**
 * The basic rock "money beat": closed hi-hat on every 8th note, kick on 1
 * and 3, snare backbeat on 2 and 4. One 4/4 measure, straight (no swing).
 */
export function moneyBeat(): GrooveScore {
  const hihatTicks = [0, 240, 480, 720, 960, 1200, 1440, 1680]
  return makeGrooveScore({
    id: 'money-beat',
    title: 'Money Beat',
    measureCount: 1,
    notes: [
      ...hihatTicks.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 240 })),
      { pad: 'kick' as const, tick: 0, durationTicks: 480 },
      { pad: 'kick' as const, tick: 960, durationTicks: 480 },
      { pad: 'snare' as const, tick: 480, durationTicks: 480 },
      { pad: 'snare' as const, tick: 1440, durationTicks: 480 },
    ],
  })
}

/**
 * `moneyBeat`, with the last "and" of beat 4 opened up — an open hi-hat
 * instead of closed, the classic way to punctuate the turnaround.
 */
export function moneyBeatOpenHat(): GrooveScore {
  const hihatTicks = [0, 240, 480, 720, 960, 1200, 1440]
  return makeGrooveScore({
    id: 'money-beat-open-hat',
    title: 'Money Beat (Open Hat)',
    measureCount: 1,
    notes: [
      ...hihatTicks.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 240 })),
      { pad: 'hhOpen' as const, tick: 1680, durationTicks: 240, articulations: ['open' as const] },
      { pad: 'kick' as const, tick: 0, durationTicks: 480 },
      { pad: 'kick' as const, tick: 960, durationTicks: 480 },
      { pad: 'snare' as const, tick: 480, durationTicks: 480 },
      { pad: 'snare' as const, tick: 1440, durationTicks: 480 },
    ],
  })
}

/**
 * A ghosted funk bar: closed hi-hat on all sixteen 16th notes, kick on a
 * syncopated "1 a 3 a"-ish pattern, snare accents on 2 and 4 with ghost
 * notes filling most of the rest of the sixteenth grid. Every note sits on
 * the same 120-tick (sixteenth) grid, kept uniform on purpose.
 *
 * Sixteenth-note index -> tick: `idx * 120` ("1 e & a 2 e & a 3 e & a 4 e a").
 */
export function ghostFunkBar(): GrooveScore {
  const SIXTEENTH = 120
  const idxToTick = (idx: number): number => idx * SIXTEENTH
  const allSixteenths = Array.from({ length: 16 }, (_, idx) => idxToTick(idx))
  const kickIdx = [0, 3, 8, 11]
  const accentIdx = [4, 12]
  const ghostIdx = [1, 2, 6, 7, 9, 10, 14, 15]

  return makeGrooveScore({
    id: 'ghost-funk-bar',
    title: 'Ghost Funk Bar',
    measureCount: 1,
    notes: [
      ...allSixteenths.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: SIXTEENTH })),
      ...kickIdx.map((idx) => ({ pad: 'kick' as const, tick: idxToTick(idx), durationTicks: SIXTEENTH })),
      ...accentIdx.map((idx) => ({
        pad: 'snare' as const,
        tick: idxToTick(idx),
        durationTicks: SIXTEENTH,
        dynamics: 'accent' as const,
      })),
      ...ghostIdx.map((idx) => ({
        pad: 'snare' as const,
        tick: idxToTick(idx),
        durationTicks: SIXTEENTH,
        dynamics: 'ghost' as const,
      })),
    ],
  })
}

/** All four, for tests that want to sweep every reference groove. */
export function referenceGrooves(): readonly GrooveScore[] {
  return [quarterNoteRock(), moneyBeat(), moneyBeatOpenHat(), ghostFunkBar()]
}
