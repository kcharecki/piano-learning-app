import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ActivityKind, PracticeEntry } from '@core/progress/log.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarSessionState } from '@core/eartraining/session.ts'
import { ticks } from '@core/shared/units.ts'
import {
  exportCsv,
  exportJson,
  importProgress,
  type EarTrainingSnapshot,
  type ProgressSnapshot,
  type RepertoirePieceLike,
  type StoredAssessmentLike,
} from './export.ts'

// ---------------------------------------------------------------------------
// arbitraries
// ---------------------------------------------------------------------------

const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'warmup',
  'technique',
  'sightreading',
  'repertoire',
  'lesson',
  'theory',
  'eartraining',
]

/** A finite double, full range including -0 (vitest's `toEqual` does not distinguish
 *  -0 from 0, so the round-trip property below is a genuine full-domain check). */
const arbFiniteNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true })

const arbId = fc.string({ minLength: 1, maxLength: 12 })
/** A string built from an alphabet weighted toward the CSV-nasty characters (comma,
 *  quote, newline, CR) so those cases actually occur, not just theoretically could. */
const arbNastyString = fc
  .array(fc.constantFrom('a', 'b', '1', ' ', ',', '"', '\n', '\r'), { minLength: 0, maxLength: 20 })
  .map((chars) => chars.join(''))

const arbPracticeEntry: fc.Arbitrary<PracticeEntry> = fc
  .record({
    id: arbId,
    startedAt: arbFiniteNumber(0, 2_000_000_000_000),
    durationMs: arbFiniteNumber(0, 100_000),
    kind: fc.constantFrom(...ACTIVITY_KINDS),
    itemId: fc.option(arbId, { nil: undefined }),
    itemName: arbNastyString,
    tempoBpm: fc.option(arbFiniteNumber(20, 300), { nil: undefined }),
    accuracy: fc.option(arbFiniteNumber(0, 1), { nil: undefined }),
    note: fc.option(arbNastyString, { nil: undefined }),
  })
  .map(
    ({
      id,
      startedAt,
      durationMs,
      kind,
      itemId,
      itemName,
      tempoBpm,
      accuracy,
      note,
    }): PracticeEntry => ({
      id,
      startedAt,
      endedAt: startedAt + durationMs,
      kind,
      ...(itemId === undefined ? {} : { itemId }),
      itemName,
      ...(tempoBpm === undefined ? {} : { tempoBpm }),
      ...(accuracy === undefined ? {} : { accuracy }),
      ...(note === undefined ? {} : { note }),
    }),
  )

const arbCard: fc.Arbitrary<Card> = fc.record({
  id: arbId,
  due: arbFiniteNumber(0, 2_000_000_000_000),
  intervalDays: arbFiniteNumber(0, 1000),
  ease: arbFiniteNumber(1.3, 5),
  reps: fc.integer({ min: 0, max: 1000 }),
  lapses: fc.integer({ min: 0, max: 1000 }),
  introducedAt: arbFiniteNumber(0, 2_000_000_000_000),
})

const arbSightReadingRecord: fc.Arbitrary<SightReadingRecord> = fc.record({
  pieceId: arbId,
  readAt: arbFiniteNumber(0, 2_000_000_000_000),
  accuracy: arbFiniteNumber(0, 1),
  level: arbFiniteNumber(0, 20),
})

const arbRepertoirePieceLike: fc.Arbitrary<RepertoirePieceLike> = fc
  .record({
    id: arbId,
    title: arbNastyString,
    composer: fc.option(arbNastyString, { nil: undefined }),
    status: fc.option(arbNastyString, { nil: undefined }),
    addedAt: fc.option(arbFiniteNumber(0, 2_000_000_000_000), { nil: undefined }),
  })
  .map(({ id, title, composer, status, addedAt }): RepertoirePieceLike => ({
    id,
    title,
    ...(composer === undefined ? {} : { composer }),
    ...(status === undefined ? {} : { status }),
    ...(addedAt === undefined ? {} : { addedAt }),
  }))

const arbStoredAssessmentLike: fc.Arbitrary<StoredAssessmentLike> = fc
  .record({
    id: arbId,
    at: arbFiniteNumber(0, 2_000_000_000_000),
    accuracy: arbFiniteNumber(0, 1),
    kind: fc.option(arbNastyString, { nil: undefined }),
    itemId: fc.option(arbId, { nil: undefined }),
  })
  .map(({ id, at, accuracy, kind, itemId }): StoredAssessmentLike => ({
    id,
    at,
    accuracy,
    ...(kind === undefined ? {} : { kind }),
    ...(itemId === undefined ? {} : { itemId }),
  }))

const arbTechniqueAttempt: fc.Arbitrary<TechniqueAttempt> = fc.record({
  drillId: arbId,
  at: arbFiniteNumber(0, 2_000_000_000_000),
  bpm: arbFiniteNumber(20, 300),
  evenness: arbFiniteNumber(0, 1),
  accuracy: arbFiniteNumber(0, 1),
  clean: fc.boolean(),
})

const arbLevels: fc.Arbitrary<Readonly<Record<string, number>>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }),
  fc.integer({ min: 0, max: 20 }),
)

const arbSnapshot: fc.Arbitrary<ProgressSnapshot> = fc
  .record({
    exportedAt: arbFiniteNumber(0, 2_000_000_000_000),
    practiceEntries: fc.array(arbPracticeEntry, { maxLength: 5 }),
    srsCards: fc.array(arbCard, { maxLength: 5 }),
    sightReadingHistory: fc.array(arbSightReadingRecord, { maxLength: 5 }),
    levels: arbLevels,
    repertoire: fc.array(arbRepertoirePieceLike, { maxLength: 5 }),
    assessments: fc.array(arbStoredAssessmentLike, { maxLength: 5 }),
    // minLength: 1 (not the maxLength-only: 5 every sibling array above uses)
    // is deliberate: this arbitrary must actually POPULATE techniqueAttempts
    // on every run, or this property would pass even against an
    // implementation that silently drops the field on import — which is
    // exactly the bug this field closes.
    techniqueAttempts: fc.array(arbTechniqueAttempt, { minLength: 1, maxLength: 5 }),
  })
  .map(
    ({
      exportedAt,
      practiceEntries,
      srsCards,
      sightReadingHistory,
      levels,
      repertoire,
      assessments,
      techniqueAttempts,
    }): ProgressSnapshot => ({
      version: 1,
      exportedAt,
      practiceEntries,
      srsCards,
      sightReadingHistory,
      levels,
      repertoire,
      assessments,
      techniqueAttempts,
    }),
  )

// ---------------------------------------------------------------------------
// round trip
// ---------------------------------------------------------------------------

describe('round trip', () => {
  it('importProgress(exportJson(s)) deep-equals s for every valid snapshot', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const result = importProgress(exportJson(snapshot))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.value).toEqual(snapshot)
      }),
      { numRuns: 200 },
    )
  })

  it('does not write fields beyond what importProgress can read back', () => {
    const snapshot: ProgressSnapshot = {
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      // A wider real-world object than `RepertoirePieceLike` declares, e.g. once
      // `@core/repertoire` grows extra fields (roadmap 4.5). exportJson must not
      // write `secretField` to the file, since importProgress would silently
      // drop it on restore anyway — writing it would be a lie about what backup
      // actually preserves.
      repertoire: [
        { id: 'r-1', title: 'Nocturne', secretField: 'should not survive export' } as unknown as {
          readonly id: string
          readonly title: string
        },
      ],
      assessments: [
        {
          id: 'a-1',
          at: 0,
          accuracy: 0.5,
          secretField: 'should not survive export',
        } as unknown as { readonly id: string; readonly at: number; readonly accuracy: number },
      ],
      techniqueAttempts: [],
    }
    const json = exportJson(snapshot)
    expect(json).not.toContain('secretField')
    expect(json).not.toContain('should not survive export')
  })

  it('throws (programmer error) rather than silently write null for NaN/Infinity', () => {
    const snapshot: ProgressSnapshot = {
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      repertoire: [],
      assessments: [{ id: 'a-1', at: 0, accuracy: NaN }],
      techniqueAttempts: [],
    }
    expect(() => exportJson(snapshot)).toThrow(/non-finite/)
  })

  it('round-trips an empty snapshot', () => {
    const snapshot: ProgressSnapshot = {
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      repertoire: [],
      assessments: [],
      techniqueAttempts: [],
    }
    const result = importProgress(exportJson(snapshot))
    expect(result).toEqual({ ok: true, value: snapshot })
  })

  it('round-trips a non-empty techniqueAttempts through exportJson -> importProgress (regression: exportJson spreads it in, but importProgress used to build a fresh object from only its own declared fields and silently drop it back out)', () => {
    const attempt: TechniqueAttempt = {
      drillId: 'scale-c-major-2oct-hands-together',
      at: 4_000,
      bpm: 84,
      evenness: 0.9,
      accuracy: 1,
      clean: true,
    }
    const snapshot: ProgressSnapshot = {
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      repertoire: [],
      assessments: [],
      techniqueAttempts: [attempt],
    }
    const result = importProgress(exportJson(snapshot))
    expect(result).toEqual({ ok: true, value: snapshot })
  })

  it('tolerates an older export file with no techniqueAttempts field at all, defaulting it to empty', () => {
    // Deliberately built WITHOUT a techniqueAttempts key — exactly what a file
    // exported before this field existed looks like. Must still import
    // successfully, not fail as if a required collection were missing.
    const olderExport = JSON.stringify({
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      repertoire: [],
      assessments: [],
    })
    const result = importProgress(olderExport)
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
      },
    })
  })

  it(
    'round-trips a present earTraining session + item cache through exportJson -> ' +
      'importProgress exactly (roadmap review finding 1: this used to be an app-layer-only ' +
      'field that a real downloaded-then-reimported file silently dropped)',
    () => {
      const earItem: EarItem = {
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
        level: 3,
      }
      const earSession: EarSessionState = {
        ...emptyEarSession(),
        levels: { ...emptyEarSession().levels, 'interval-melodic': 3 },
        attempts: [{ itemId: earItem.id, kind: earItem.kind, accuracy: 1, at: 7_000, level: 2 }],
        cards: [
          { id: earItem.id, due: 8_000, intervalDays: 1, ease: 2.5, reps: 1, lapses: 0, introducedAt: 0 },
        ],
        kinds: { [earItem.id]: earItem.kind },
      }
      const earTraining: EarTrainingSnapshot = { session: earSession, itemsById: { [earItem.id]: earItem } }
      const snapshot: ProgressSnapshot = {
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
        earTraining,
      }
      const result = importProgress(exportJson(snapshot))
      expect(result).toEqual({ ok: true, value: snapshot })
    },
  )

  it(
    'leaves earTraining genuinely ABSENT (never defaulted to an empty session) when the source ' +
      'file has no earTraining key — unlike techniqueAttempts, an absent earTraining must stay ' +
      'absent so the caller can tell "no data" apart from "empty session" (see the type doc comment)',
    () => {
      const olderExport = JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
      })
      const result = importProgress(olderExport)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect('earTraining' in result.value).toBe(false)
        expect(result.value.earTraining).toBeUndefined()
      }
    },
  )

  it(
    'round-trips ear attempts with FRACTIONAL accuracy exactly (roadmap 3.26): a value that ' +
      'survives only if accuracy is genuinely preserved as a number, not collapsed to 1/0',
    () => {
      const earSession: EarSessionState = {
        ...emptyEarSession(),
        levels: { ...emptyEarSession().levels, 'melodic-dictation': 2 },
        attempts: [
          { itemId: 'a-1', kind: 'melodic-dictation', accuracy: 0.75, at: 1_000, level: 2 },
          { itemId: 'a-2', kind: 'rhythmic-dictation', accuracy: 0.4, at: 2_000, level: 1 },
        ],
        cards: [],
        kinds: { 'a-1': 'melodic-dictation', 'a-2': 'rhythmic-dictation' },
      }
      const earTraining: EarTrainingSnapshot = { session: earSession, itemsById: {} }
      const snapshot: ProgressSnapshot = {
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
        earTraining,
      }
      const result = importProgress(exportJson(snapshot))
      expect(result).toEqual({ ok: true, value: snapshot })
    },
  )

  it('imports a LEGACY (pre-3.26) ear attempt with `correct: boolean` and no `accuracy`, mapping correct: true -> accuracy: 1', () => {
    const legacyExport = JSON.stringify({
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      repertoire: [],
      assessments: [],
      techniqueAttempts: [],
      earTraining: {
        session: {
          ...emptyEarSession(),
          attempts: [{ itemId: 'legacy-1', kind: 'interval-melodic', correct: true, at: 1_000, level: 1 }],
        },
        itemsById: {},
      },
    })
    const result = importProgress(legacyExport)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.earTraining?.session.attempts).toEqual([
        { itemId: 'legacy-1', kind: 'interval-melodic', accuracy: 1, at: 1_000, level: 1 },
      ])
    }
  })

  it('imports a LEGACY (pre-3.26) ear attempt with `correct: false`, mapping it to accuracy: 0', () => {
    const legacyExport = JSON.stringify({
      version: 1,
      exportedAt: 0,
      practiceEntries: [],
      srsCards: [],
      sightReadingHistory: [],
      levels: {},
      repertoire: [],
      assessments: [],
      techniqueAttempts: [],
      earTraining: {
        session: {
          ...emptyEarSession(),
          attempts: [{ itemId: 'legacy-2', kind: 'interval-melodic', correct: false, at: 1_000, level: 1 }],
        },
        itemsById: {},
      },
    })
    const result = importProgress(legacyExport)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.earTraining?.session.attempts).toEqual([
        { itemId: 'legacy-2', kind: 'interval-melodic', accuracy: 0, at: 1_000, level: 1 },
      ])
    }
  })

  it.each([
    ['above 1', 2],
    ['below 0', -0.5],
    ['a string', 'high'],
  ])('rejects an ear attempt with accuracy %s, naming the path', (_label, badAccuracy) => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
        earTraining: {
          session: {
            ...emptyEarSession(),
            attempts: [
              { itemId: 'bad-1', kind: 'interval-melodic', accuracy: badAccuracy, at: 1_000, level: 1 },
            ],
          },
          itemsById: {},
        },
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/earTraining\.session\.attempts\[0\]\.accuracy/)
    }
  })

  it('rejects an earTraining.session with a malformed card, naming the field', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
        earTraining: {
          session: { ...emptyEarSession(), cards: [{ id: 'x', due: 1 }] },
          itemsById: {},
        },
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/earTraining\.session\.cards\[0\]/)
  })

  it('rejects a techniqueAttempts entry missing a required field, naming the field', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [{ drillId: 'scale-c-major', at: 0, bpm: 80, evenness: 0.9 }], // missing accuracy/clean
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/techniqueAttempts\[0\]/)
      expect(result.error).toMatch(/accuracy/)
    }
  })
})

// ---------------------------------------------------------------------------
// corruption
// ---------------------------------------------------------------------------

describe('importProgress: corruption', () => {
  it('rejects truncated JSON', () => {
    const result = importProgress('{"version": 1, "exportedAt": 123, "practiceEntries": [')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/invalid JSON/i)
  })

  it('rejects a wrong version with a clear message', () => {
    const result = importProgress(
      JSON.stringify({
        version: 2,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/version/i)
  })

  it('rejects a missing version', () => {
    const result = importProgress(
      JSON.stringify({
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/version/i)
  })

  it('rejects a practice entry missing a required field, naming the field', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [{ id: 'pe-1', startedAt: 0, endedAt: 100, kind: 'warmup' }], // missing itemName
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/practiceEntries\[0\]/)
      expect(result.error).toMatch(/itemName/)
    }
  })

  it('rejects a null where an array belongs', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: null,
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/practiceEntries/)
      expect(result.error).toMatch(/array/i)
    }
  })

  it('rejects an invalid ActivityKind', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [
          { id: 'pe-1', startedAt: 0, endedAt: 100, kind: 'not-a-kind', itemName: 'Scales' },
        ],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/kind/)
  })

  it('rejects a practice entry with endedAt before startedAt', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [
          { id: 'pe-1', startedAt: 1000, endedAt: 500, kind: 'warmup', itemName: 'Scales' },
        ],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/practiceEntries\[0\]\.endedAt/)
      expect(result.error).toMatch(/before startedAt/)
    }
  })

  it('rejects a non-object root', () => {
    const result = importProgress('"just a string"')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/root/)
  })

  it('rejects levels with a non-number value', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: { scales: 'five' },
        repertoire: [],
        assessments: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/levels\.scales/)
  })

  it('drops unknown extra fields rather than failing', () => {
    const result = importProgress(
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        somethingFromTheFuture: { whatever: true },
      }),
    )
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        exportedAt: 0,
        practiceEntries: [],
        srsCards: [],
        sightReadingHistory: [],
        levels: {},
        repertoire: [],
        assessments: [],
        techniqueAttempts: [],
      },
    })
  })
})

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('exportCsv', () => {
  const baseSnapshot: ProgressSnapshot = {
    version: 1,
    exportedAt: 0,
    practiceEntries: [],
    srsCards: [],
    sightReadingHistory: [],
    levels: {},
    repertoire: [],
    assessments: [],
    techniqueAttempts: [],
  }

  it('emits one CSV per collection', () => {
    const bundle = exportCsv(baseSnapshot)
    expect(Object.keys(bundle).sort()).toEqual(
      [
        'assessments',
        'levels',
        'practiceEntries',
        'repertoire',
        'sightReadingHistory',
        'srsCards',
      ].sort(),
    )
  })

  it('quotes a practice entry note containing a comma, a quote, and a newline', () => {
    const nasty = 'has, a comma "and a quote" and\na newline'
    const snapshot: ProgressSnapshot = {
      ...baseSnapshot,
      practiceEntries: [
        {
          id: 'pe-1',
          startedAt: 0,
          endedAt: 60_000,
          kind: 'warmup',
          itemName: 'Scales',
          note: nasty,
        },
      ],
    }
    const csv = exportCsv(snapshot).practiceEntries
    expect(csv).toContain('"has, a comma ""and a quote"" and\na newline"')
  })

  it('quotes a repertoire title/composer with the same nasty characters', () => {
    const nasty = 'Nocturne, "Op. 9 No. 2"\nChopin edit'
    const snapshot: ProgressSnapshot = {
      ...baseSnapshot,
      repertoire: [{ id: 'r-1', title: nasty }],
    }
    const csv = exportCsv(snapshot).repertoire
    expect(csv).toContain('"Nocturne, ""Op. 9 No. 2""\nChopin edit"')
  })

  it('leaves plain fields unquoted', () => {
    const snapshot: ProgressSnapshot = {
      ...baseSnapshot,
      srsCards: [
        { id: 'c-1', due: 100, intervalDays: 4, ease: 2.5, reps: 3, lapses: 0, introducedAt: 0 },
      ],
    }
    const csv = exportCsv(snapshot).srsCards
    expect(csv.split('\n')).toEqual([
      'id,due,intervalDays,ease,reps,lapses,introducedAt',
      'c-1,100,4,2.5,3,0,0',
    ])
  })

  it('renders levels as key,level rows', () => {
    const snapshot: ProgressSnapshot = { ...baseSnapshot, levels: { scales: 3, sightreading: 5 } }
    const csv = exportCsv(snapshot).levels
    expect(csv).toBe('key,level\nscales,3\nsightreading,5')
  })

  /** Minimal RFC-4180 scanner: splits `text` into rows of fields, honoring quoted
   *  fields (which may contain commas/newlines) and doubled-quote escaping. Used
   *  as a real oracle so the property test below can catch a broken/no-op quoter,
   *  not just check the literal prefix. */
  function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let inQuotes = false
    let i = 0
    while (i < text.length) {
      const c = text[i]
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i += 2
            continue
          }
          inQuotes = false
          i += 1
          continue
        }
        field += c
        i += 1
        continue
      }
      if (c === '"') {
        inQuotes = true
        i += 1
        continue
      }
      if (c === ',') {
        row.push(field)
        field = ''
        i += 1
        continue
      }
      if (c === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
        i += 1
        continue
      }
      field += c
      i += 1
    }
    row.push(field)
    rows.push(row)
    return rows
  }

  it('adversarial strings round-trip through the CSV scanner as exactly one row', () => {
    fc.assert(
      fc.property(arbNastyString, arbNastyString, (title, composer) => {
        const csv = exportCsv({
          ...baseSnapshot,
          repertoire: [{ id: 'r-1', title, composer }],
        }).repertoire
        const rows = parseCsv(csv)
        expect(rows).toEqual([
          ['id', 'title', 'composer', 'status', 'addedAt'],
          ['r-1', title, composer, '', ''],
        ])
      }),
      { numRuns: 200 },
    )
  })

  it('a mutant that removes quoting is caught: a comma-containing field must not merge into two columns', () => {
    const csv = exportCsv({
      ...baseSnapshot,
      repertoire: [{ id: 'r-1', title: 'a,b', composer: 'c' }],
    }).repertoire
    const rows = parseCsv(csv)
    expect(rows[1]).toEqual(['r-1', 'a,b', 'c', '', ''])
  })
})
