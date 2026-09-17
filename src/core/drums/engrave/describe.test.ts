/**
 * `describeGroove` is the whole reason a screen-reader learner can use the
 * drums trainer at all, so these are exact-string assertions, not shape
 * checks — a subtly wrong sentence is as broken as a missing one. The label
 * function below mirrors `GROOVE_PAD_LABEL` (`src/app/drums/groove/padLabels.ts`)
 * for only the pads the fixtures here use; it is intentionally local rather
 * than importing that UI module, for the same reason `describeGroove` takes
 * `padLabel` as a parameter (see `describe.ts`'s module doc).
 */
import { describe, expect, it } from 'vitest'
import { makeGrooveScore } from '@core/drums/model/groove.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import {
  ghostFunkBar,
  moneyBeat,
  moneyBeatOpenHat,
  quarterNoteRock,
} from '@core/drums/model/referenceGrooves.ts'
import { describeGroove } from './describe.ts'

const LABEL: Readonly<Partial<Record<MappedDrumPad, string>>> = {
  kick: 'Kick',
  snare: 'Snare',
  hhClosed: 'Hi-hat',
  hhOpen: 'Open hi-hat',
}

function label(pad: MappedDrumPad): string {
  const text = LABEL[pad]
  if (text === undefined) throw new Error(`no test label for pad ${pad}`)
  return text
}

describe('describeGroove — reference grooves', () => {
  it('quarterNoteRock: every-beat hi-hat, individually listed kick/snare', () => {
    expect(describeGroove(quarterNoteRock(), label)).toBe(
      'Quarter-Note Rock in 4/4. Kick: 1, 3. Snare: 2, 4. Hi-hat: every beat.',
    )
  })

  it('moneyBeat: every-eighth hi-hat', () => {
    expect(describeGroove(moneyBeat(), label)).toBe(
      'Money Beat in 4/4. Kick: 1, 3. Snare: 2, 4. Hi-hat: every eighth.',
    )
  })

  it('moneyBeatOpenHat: the one missing eighth breaks the collapse, open hat gets its own clause', () => {
    expect(describeGroove(moneyBeatOpenHat(), label)).toBe(
      'Money Beat (Open Hat) in 4/4. Kick: 1, 3. Snare: 2, 4. ' +
        'Hi-hat: 1, 1 &, 2, 2 &, 3, 3 &, 4. Open hi-hat: 4 &.',
    )
  })

  it('ghostFunkBar: every-sixteenth hi-hat, ghost+accent snare positions each carry their mark', () => {
    expect(describeGroove(ghostFunkBar(), label)).toBe(
      'Ghost Funk Bar in 4/4. Kick: 1, 1 a, 3, 3 a. ' +
        'Snare: 1 e (ghost), 1 & (ghost), 2 (accent), 2 & (ghost), 2 a (ghost), ' +
        '3 e (ghost), 3 & (ghost), 4 (accent), 4 & (ghost), 4 a (ghost). Hi-hat: every sixteenth.',
    )
  })
})

describe('describeGroove — title', () => {
  it('omits the title (and its trailing space) when the score has none', () => {
    const score = makeGrooveScore({
      id: 'no-title',
      title: '',
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 0, durationTicks: 480 }],
    })
    expect(describeGroove(score, label)).toBe('In 4/4. Kick: 1.')
  })

  it('an empty score is just the title clause, no pad clauses', () => {
    const score = makeGrooveScore({ id: 'silence', title: 'Silence', measureCount: 1, notes: [] })
    expect(describeGroove(score, label)).toBe('Silence in 4/4.')
  })
})

describe('describeGroove — multi-measure grouping', () => {
  it('prefixes each measure with "bar n: " and separates measures with "; "', () => {
    const score = makeGrooveScore({
      id: 'two-bar',
      title: 'Two Bar',
      measureCount: 2,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 480 },
        { pad: 'kick', tick: 1920 + 240, durationTicks: 480 },
      ],
    })
    expect(describeGroove(score, label)).toBe('Two Bar in 4/4. Kick: bar 1: 1; bar 2: 1 &.')
  })
})

describe('describeGroove — every eighth / sixteenth / beat collapse', () => {
  it('fires "every eighth" when all 8 eighths of the bar are hit', () => {
    const ticksList = [0, 240, 480, 720, 960, 1200, 1440, 1680]
    const score = makeGrooveScore({
      id: 'eighth-full',
      title: 'Eighth Full',
      measureCount: 1,
      notes: ticksList.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 240 })),
    })
    expect(describeGroove(score, label)).toBe('Eighth Full in 4/4. Hi-hat: every eighth.')
  })

  it('does not fire "every eighth" when one of the 8 is missing', () => {
    const ticksList = [0, 240, 480, 720, 960, 1200, 1440] // last eighth (1680) missing
    const score = makeGrooveScore({
      id: 'eighth-gap',
      title: 'Eighth Gap',
      measureCount: 1,
      notes: ticksList.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 240 })),
    })
    expect(describeGroove(score, label)).toBe(
      'Eighth Gap in 4/4. Hi-hat: 1, 1 &, 2, 2 &, 3, 3 &, 4.',
    )
  })

  it('fires "every sixteenth" when all 16 sixteenths of the bar are hit', () => {
    const ticksList = Array.from({ length: 16 }, (_, i) => i * 120)
    const score = makeGrooveScore({
      id: 'sixteenth-full',
      title: 'Sixteenth Full',
      measureCount: 1,
      notes: ticksList.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 120 })),
    })
    expect(describeGroove(score, label)).toBe('Sixteenth Full in 4/4. Hi-hat: every sixteenth.')
  })

  it('does not fire "every sixteenth" when one of the 16 is missing', () => {
    const ticksList = Array.from({ length: 15 }, (_, i) => i * 120) // last sixteenth (1800) missing
    const score = makeGrooveScore({
      id: 'sixteenth-gap',
      title: 'Sixteenth Gap',
      measureCount: 1,
      notes: ticksList.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 120 })),
    })
    expect(describeGroove(score, label)).toBe(
      'Sixteenth Gap in 4/4. Hi-hat: 1, 1 e, 1 &, 1 a, 2, 2 e, 2 &, 2 a, ' +
        '3, 3 e, 3 &, 3 a, 4, 4 e, 4 &.',
    )
  })

  it('fires "every beat" when all 4 beats of the bar are hit', () => {
    const ticksList = [0, 480, 960, 1440]
    const score = makeGrooveScore({
      id: 'beat-full',
      title: 'Beat Full',
      measureCount: 1,
      notes: ticksList.map((tick) => ({ pad: 'kick' as const, tick, durationTicks: 480 })),
    })
    expect(describeGroove(score, label)).toBe('Beat Full in 4/4. Kick: every beat.')
  })

  it('does not fire "every beat" when one of the 4 is missing', () => {
    const ticksList = [0, 480, 960] // beat 4 (1440) missing
    const score = makeGrooveScore({
      id: 'beat-gap',
      title: 'Beat Gap',
      measureCount: 1,
      notes: ticksList.map((tick) => ({ pad: 'kick' as const, tick, durationTicks: 480 })),
    })
    expect(describeGroove(score, label)).toBe('Beat Gap in 4/4. Kick: 1, 2, 3.')
  })
})

describe('describeGroove — pad ordering', () => {
  it('orders clauses by padOrderIndex, not by which pad is hit first in the bar', () => {
    // hhClosed's only note lands before kick's in the bar, but kick outranks
    // hhClosed in padOrderIndex — the sentence must still say Kick first.
    const score = makeGrooveScore({
      id: 'order-test',
      title: 'Order Test',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 120 },
        { pad: 'kick', tick: 240, durationTicks: 480 },
      ],
    })
    expect(describeGroove(score, label)).toBe('Order Test in 4/4. Kick: 1 &. Hi-hat: 1.')
  })
})

describe('describeGroove — off-grid tick', () => {
  it('names a tick that lands off the sixteenth grid as "<beat> +<n> ticks" instead of lying', () => {
    const score = makeGrooveScore({
      id: 'off-grid',
      title: 'Off Grid',
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 30, durationTicks: 60 }],
    })
    expect(describeGroove(score, label)).toBe('Off Grid in 4/4. Kick: 1 +30 ticks.')
  })
})

describe('describeGroove — playCount', () => {
  it('appends "Played twice." when playCount is 2', () => {
    expect(describeGroove(quarterNoteRock(), label, { playCount: 2 })).toBe(
      'Quarter-Note Rock in 4/4. Kick: 1, 3. Snare: 2, 4. Hi-hat: every beat. Played twice.',
    )
  })

  it('appends "Played 3 times." for any other count', () => {
    expect(describeGroove(quarterNoteRock(), label, { playCount: 3 })).toBe(
      'Quarter-Note Rock in 4/4. Kick: 1, 3. Snare: 2, 4. Hi-hat: every beat. Played 3 times.',
    )
  })

  it('says nothing extra when playCount is 1 or the options argument is omitted entirely', () => {
    const withExplicitOne = describeGroove(quarterNoteRock(), label, { playCount: 1 })
    const withNoOptions = describeGroove(quarterNoteRock(), label)
    const expected = 'Quarter-Note Rock in 4/4. Kick: 1, 3. Snare: 2, 4. Hi-hat: every beat.'
    expect(withExplicitOne).toBe(expected)
    expect(withNoOptions).toBe(expected)
  })
})
