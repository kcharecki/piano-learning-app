/**
 * Focused validator tests for `isValidEarTraining` (roadmap 3.11, REQ-3.6.3).
 * Every other validator in `persistedShapes.ts` is already exercised through
 * `persistence.test.ts`'s corrupt-payload tables; this file exists because
 * `isValidEarTraining` is new and its own file has no home yet — see the
 * module comment on why the validator must reject at every level, not just
 * the top one.
 */
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarSessionState } from '@core/eartraining/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import { ticks } from '@core/shared/units.ts'
import { describe, expect, it } from 'vitest'
import { isValidEarTraining, type PersistedEarTraining } from './persistedShapes.ts'

const CARD_A: Card = {
  id: 'interval-melodic:48:55:asc',
  due: 100,
  intervalDays: 1,
  ease: 2.5,
  reps: 1,
  lapses: 0,
  introducedAt: 0,
}

const ITEM_A: EarItem = {
  id: 'interval-melodic:48:55:asc',
  kind: 'interval-melodic',
  prompt: {
    id: 'interval-melodic:48:55:asc',
    meta: { title: '', composer: '' },
    measures: [],
    notes: [],
    tempos: [],
    staves: [],
    maxNoteDurationTicks: ticks(0),
  },
  answerKey: 'P5',
  level: 1,
}

function validSession(): EarSessionState {
  return {
    ...emptyEarSession(),
    levels: { ...emptyEarSession().levels, 'interval-melodic': 3 },
    attempts: [{ itemId: ITEM_A.id, kind: 'interval-melodic', correct: true, at: 100, level: 2 }],
    cards: [CARD_A],
    kinds: { [ITEM_A.id]: 'interval-melodic' },
  }
}

function validPayload(): PersistedEarTraining {
  return { session: validSession(), itemsById: { [ITEM_A.id]: ITEM_A } }
}

describe('isValidEarTraining', () => {
  it('accepts a well-formed payload', () => {
    expect(isValidEarTraining(validPayload())).toBe(true)
  })

  it('accepts the empty-session default (every field is either empty or the min level)', () => {
    expect(isValidEarTraining({ session: emptyEarSession(), itemsById: {} })).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['session missing', { itemsById: {} }],
    ['session not an object', { session: 'nope', itemsById: {} }],
    ['itemsById missing', { session: validSession() }],
    ['itemsById not an object', { session: validSession(), itemsById: 'nope' }],
    ['itemsById is an array', { session: validSession(), itemsById: [] }],

    // session.levels
    [
      'session.levels missing a kind',
      {
        session: { ...validSession(), levels: { 'interval-melodic': 1 } },
        itemsById: {},
      },
    ],
    [
      'session.levels has an extra, unknown kind',
      {
        session: { ...validSession(), levels: { ...emptyEarSession().levels, bogus: 1 } },
        itemsById: {},
      },
    ],
    [
      'session.levels has a non-finite level',
      {
        session: {
          ...validSession(),
          levels: { ...emptyEarSession().levels, 'interval-melodic': Number.NaN },
        },
        itemsById: {},
      },
    ],
    [
      'session.levels has a level below EAR_MIN_LEVEL',
      {
        session: { ...validSession(), levels: { ...emptyEarSession().levels, 'chord-quality': 0 } },
        itemsById: {},
      },
    ],
    [
      'session.levels has a level above EAR_MAX_LEVEL',
      {
        session: { ...validSession(), levels: { ...emptyEarSession().levels, 'scale-mode': 6 } },
        itemsById: {},
      },
    ],
    [
      'session.levels has a non-integer (fractional) level',
      {
        session: { ...validSession(), levels: { ...emptyEarSession().levels, 'interval-melodic': 2.5 } },
        itemsById: {},
      },
    ],

    // session.attempts
    [
      'session.attempts is not an array',
      { session: { ...validSession(), attempts: 'nope' }, itemsById: {} },
    ],
    [
      'an attempt missing itemId',
      {
        session: { ...validSession(), attempts: [{ kind: 'interval-melodic', correct: true, at: 1, level: 1 }] },
        itemsById: {},
      },
    ],
    [
      'an attempt with an invalid kind',
      {
        session: {
          ...validSession(),
          attempts: [{ itemId: 'x', kind: 'not-a-kind', correct: true, at: 1, level: 1 }],
        },
        itemsById: {},
      },
    ],
    [
      'an attempt with a non-boolean correct',
      {
        session: {
          ...validSession(),
          attempts: [{ itemId: 'x', kind: 'interval-melodic', correct: 'yes', at: 1, level: 1 }],
        },
        itemsById: {},
      },
    ],
    [
      'an attempt with a non-finite at',
      {
        session: {
          ...validSession(),
          attempts: [{ itemId: 'x', kind: 'interval-melodic', correct: true, at: Number.NaN, level: 1 }],
        },
        itemsById: {},
      },
    ],

    // session.cards (reuses isValidCard — one representative failure)
    [
      'session.cards has a card with a non-finite ease',
      {
        session: { ...validSession(), cards: [{ ...CARD_A, ease: Number.NaN }] },
        itemsById: {},
      },
    ],
    [
      'a card whose id has no entry in session.kinds — the exact corrupt payload named in ' +
        'session.ts (a card seeded from storage that persisted cards but not the kinds map), ' +
        'which used to pass validation and then throw an InvariantError on every Start forever',
      {
        session: {
          ...validSession(),
          cards: [CARD_A, { ...CARD_A, id: 'orphan-card-not-in-kinds' }],
        },
        itemsById: {},
      },
    ],

    // session.kinds
    [
      'session.kinds is not an object',
      { session: { ...validSession(), kinds: 'nope' }, itemsById: {} },
    ],
    [
      'session.kinds has a value that is not a valid EarItemKind',
      { session: { ...validSession(), kinds: { x: 'not-a-kind' } }, itemsById: {} },
    ],

    // itemsById entries
    [
      'an item missing id',
      { session: validSession(), itemsById: { a: { ...ITEM_A, id: undefined } } },
    ],
    [
      'an item with an invalid kind',
      { session: validSession(), itemsById: { a: { ...ITEM_A, kind: 'not-a-kind' } } },
    ],
    [
      'an item missing prompt',
      { session: validSession(), itemsById: { a: { ...ITEM_A, prompt: undefined } } },
    ],
    [
      'an item whose prompt has no notes array',
      {
        session: validSession(),
        itemsById: { a: { ...ITEM_A, prompt: { ...ITEM_A.prompt, notes: undefined } } },
      },
    ],
    [
      'an item with a non-finite level',
      { session: validSession(), itemsById: { a: { ...ITEM_A, level: Number.NaN } } },
    ],
    [
      'an item with a non-string answerKey',
      { session: validSession(), itemsById: { a: { ...ITEM_A, answerKey: 7 } } },
    ],
    [
      "an itemsById entry keyed under something other than the item's own id — the orphaning " +
        'bug isValidAnnotations already guards against for its own byScoreId map',
      { session: validSession(), itemsById: { 'wrong-key': ITEM_A } },
    ],
  ])('rejects: %s', (_label, payload) => {
    expect(isValidEarTraining(payload)).toBe(false)
  })
})
