/**
 * Focused validator tests for the drums-history corner of `persistedShapes.ts`
 * (roadmap DR-09): `isValidPadResult`, `isValidDrumsGrooveAttempt` and
 * `isValidDrumsHistory`. Every other validator in that file is already
 * exercised through `persistence.test.ts`'s corrupt-payload tables; this file
 * covers only these three, which have no coverage of their own yet.
 *
 * These are structural guards over untrusted data read back off disk, so
 * every rejection case below is something a corrupted or hand-edited
 * IndexedDB entry could plausibly contain: wrong top-level shape, a missing
 * field, a value of the wrong type, or a `pad` string that isn't one of the
 * kit's own pad names. They must return `false`, never throw — that is what
 * lets `restoreSlice` degrade one corrupt slice without taking down the
 * others (see that function's own comment in `persistence.ts`).
 */
import type { PadResult } from '@core/drums/practice/grooveGrader.ts'
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import { describe, expect, it } from 'vitest'
import {
  isValidDrumsGrooveAttempt,
  isValidDrumsHistory,
  isValidPadResult,
  type PersistedDrumsHistory,
} from './persistedShapes.ts'

const PAD_A: PadResult = {
  pad: 'hhClosed',
  expected: 16,
  matched: 16,
  missed: 0,
  extra: 0,
  meanOffsetMs: 3,
  worstOffsetMs: 8,
  spreadMs: 5,
  steady: true,
}

const ATTEMPT_A: DrumsGrooveAttempt = {
  grooveId: 'money-beat',
  grooveTitle: 'Money Beat',
  bpm: 80,
  repeats: 4,
  at: 1000,
  steady: true,
  pads: [PAD_A],
}

/** Drops `key` from `value` and returns a plain, loosely-typed clone — for building "missing a required field" payloads. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Record<string, unknown> {
  const clone = { ...value } as Record<string, unknown>
  delete clone[key as string]
  return clone
}

describe('isValidPadResult', () => {
  it('accepts a well-formed pad result with both offsets present', () => {
    expect(isValidPadResult(PAD_A)).toBe(true)
  })

  it('accepts undefined offsets (a pad that matched nothing has no offset)', () => {
    const unmatched: PadResult = {
      pad: 'snare',
      expected: 4,
      matched: 0,
      missed: 4,
      extra: 0,
      meanOffsetMs: undefined,
      worstOffsetMs: undefined,
      spreadMs: undefined,
      steady: false,
    }
    expect(isValidPadResult(unmatched)).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['a missing required field (extra)', omit(PAD_A, 'extra')],
    ['an unknown pad value', { ...PAD_A, pad: 'tuba' }],
    ['a NaN meanOffsetMs', { ...PAD_A, meanOffsetMs: Number.NaN }],
    ['a NaN worstOffsetMs', { ...PAD_A, worstOffsetMs: Number.NaN }],
    ['a NaN spreadMs', { ...PAD_A, spreadMs: Number.NaN }],
    ['a missing steady flag', omit(PAD_A, 'steady')],
    ['a string where a count belongs (expected)', { ...PAD_A, expected: '16' }],
  ])('rejects %s', (_label, value) => {
    expect(isValidPadResult(value)).toBe(false)
  })
})

describe('isValidDrumsGrooveAttempt', () => {
  it('accepts a well-formed attempt', () => {
    expect(isValidDrumsGrooveAttempt(ATTEMPT_A)).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['a missing required field (grooveTitle)', omit(ATTEMPT_A, 'grooveTitle')],
    ['a non-finite bpm', { ...ATTEMPT_A, bpm: Number.NaN }],
    ['a non-finite at', { ...ATTEMPT_A, at: Number.NaN }],
    ['a non-boolean steady', { ...ATTEMPT_A, steady: 'yes' }],
    ['the old pre-rename shape, carrying `clean` instead of `steady`', { ...omit(ATTEMPT_A, 'steady'), clean: true }],
    ['pads not an array', { ...ATTEMPT_A, pads: 'nope' }],
    [
      'a pad row with an unknown pad value',
      { ...ATTEMPT_A, pads: [{ ...PAD_A, pad: 'tuba' }] },
    ],
    [
      'a pad row with a string where a count belongs',
      { ...ATTEMPT_A, pads: [{ ...PAD_A, matched: '16' }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isValidDrumsGrooveAttempt(value)).toBe(false)
  })
})

describe('isValidDrumsHistory', () => {
  it('accepts a well-formed history', () => {
    const history: PersistedDrumsHistory = { attempts: [ATTEMPT_A] }
    expect(isValidDrumsHistory(history)).toBe(true)
  })

  it('accepts an empty attempts array (a fresh install, not corruption)', () => {
    expect(isValidDrumsHistory({ attempts: [] })).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['attempts missing', {}],
    ['attempts not an array', { attempts: 'nope' }],
    ['an attempt missing a required field', { attempts: [omit(ATTEMPT_A, 'grooveId')] }],
    [
      'an attempt whose pad row has a NaN offset',
      { attempts: [{ ...ATTEMPT_A, pads: [{ ...PAD_A, meanOffsetMs: Number.NaN }] }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isValidDrumsHistory(value)).toBe(false)
  })
})
