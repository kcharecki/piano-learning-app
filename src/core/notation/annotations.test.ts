import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeScore, type Score, type ScoreNote } from './score.ts'
import {
  applyAnnotations,
  emptyAnnotations,
  fingeringFor,
  notesForMeasure,
  removeAnnotation,
  setAnnotation,
  validateAnnotations,
  type Annotation,
  type ScoreAnnotations,
} from './annotations.ts'

const noteIdArb = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0)
const fingerArb = fc.integer({ min: 1, max: 5 })
const colourArb = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0)
const measureIndexArb = fc.nat({ max: 50 })
const textArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0)

const fingeringArb = fc.record({
  kind: fc.constant('fingering' as const),
  noteId: noteIdArb,
  finger: fingerArb,
})
const highlightArb = fc.record({
  kind: fc.constant('highlight' as const),
  noteId: noteIdArb,
  colour: colourArb,
})
const noteArb = fc.record({
  kind: fc.constant('note' as const),
  measureIndex: measureIndexArb,
  text: textArb,
})
const annotationArb: fc.Arbitrary<Annotation> = fc.oneof(fingeringArb, highlightArb, noteArb)
const noteKeyedArb: fc.Arbitrary<Annotation> = fc.oneof(fingeringArb, highlightArb)
const itemsArb = fc.array(annotationArb, { maxLength: 8 })

function buildScore(): Score {
  return makeScore({
    id: 'score-1',
    measures: [{}, {}],
    notes: [
      { midi: 60, startTick: 0, durationTicks: 240, hand: 'right' },
      { midi: 64, startTick: 240, durationTicks: 240, hand: 'right' },
      { midi: 48, startTick: 0, durationTicks: 480, hand: 'left' },
      { midi: 67, startTick: 1920, durationTicks: 240, hand: 'right' },
    ],
  })
}

describe('emptyAnnotations', () => {
  it('has no items and carries the given scoreId', () => {
    expect(emptyAnnotations('score-1')).toEqual({ scoreId: 'score-1', items: [] })
  })
})

describe('setAnnotation', () => {
  it('is idempotent per note: applying the same fingering/highlight twice matches applying it once', () => {
    fc.assert(
      fc.property(itemsArb, noteKeyedArb, (items, item) => {
        const a: ScoreAnnotations = { scoreId: 'score-1', items }
        const once = setAnnotation(a, item)
        const twice = setAnnotation(once, item)
        expect(twice).toEqual(once)
      }),
    )
  })

  it('replaces the existing fingering for a note rather than accumulating', () => {
    const a = emptyAnnotations('score-1')
    const first = setAnnotation(a, { kind: 'fingering', noteId: 'n1', finger: 2 })
    const second = setAnnotation(first, { kind: 'fingering', noteId: 'n1', finger: 4 })
    expect(second.items).toHaveLength(1)
    expect(fingeringFor(second, 'n1')).toBe(4)
  })

  it('replaces the existing highlight for a note rather than accumulating', () => {
    const a = emptyAnnotations('score-1')
    const first = setAnnotation(a, { kind: 'highlight', noteId: 'n1', colour: 'red' })
    const second = setAnnotation(first, { kind: 'highlight', noteId: 'n1', colour: 'blue' })
    const highlights = second.items.filter((i) => i.kind === 'highlight')
    expect(highlights).toEqual([{ kind: 'highlight', noteId: 'n1', colour: 'blue' }])
  })

  it('a fingering and a highlight on the same note coexist', () => {
    const a = emptyAnnotations('score-1')
    const withFingering = setAnnotation(a, { kind: 'fingering', noteId: 'n1', finger: 3 })
    const withBoth = setAnnotation(withFingering, { kind: 'highlight', noteId: 'n1', colour: 'green' })
    expect(withBoth.items).toHaveLength(2)
  })

  it('notes accumulate per measure instead of replacing', () => {
    const a = emptyAnnotations('score-1')
    const first = setAnnotation(a, { kind: 'note', measureIndex: 0, text: 'watch the pedal' })
    const second = setAnnotation(first, { kind: 'note', measureIndex: 0, text: 'slow down here' })
    expect(notesForMeasure(second, 0)).toEqual(['watch the pedal', 'slow down here'])
  })
})

describe('removeAnnotation', () => {
  it('removes a fingering by noteId regardless of the finger value passed', () => {
    const a = setAnnotation(emptyAnnotations('score-1'), {
      kind: 'fingering',
      noteId: 'n1',
      finger: 3,
    })
    const removed = removeAnnotation(a, { kind: 'fingering', noteId: 'n1', finger: 1 })
    expect(fingeringFor(removed, 'n1')).toBeUndefined()
  })

  it('removes only the exact measure note, leaving others on the same measure', () => {
    let a = emptyAnnotations('score-1')
    a = setAnnotation(a, { kind: 'note', measureIndex: 0, text: 'first' })
    a = setAnnotation(a, { kind: 'note', measureIndex: 0, text: 'second' })
    const removed = removeAnnotation(a, { kind: 'note', measureIndex: 0, text: 'first' })
    expect(notesForMeasure(removed, 0)).toEqual(['second'])
  })

  it('removes only one of two identical measure notes, keeping the other', () => {
    let a = emptyAnnotations('score-1')
    a = setAnnotation(a, { kind: 'note', measureIndex: 0, text: 'same' })
    a = setAnnotation(a, { kind: 'note', measureIndex: 0, text: 'same' })
    const removed = removeAnnotation(a, { kind: 'note', measureIndex: 0, text: 'same' })
    expect(notesForMeasure(removed, 0)).toEqual(['same'])
  })

  it('removing an item that is not present is a no-op', () => {
    const a = emptyAnnotations('score-1')
    expect(removeAnnotation(a, { kind: 'fingering', noteId: 'nope', finger: 1 })).toEqual(a)
  })
})

describe('fingeringFor / notesForMeasure', () => {
  it('return undefined / empty when nothing is set', () => {
    const a = emptyAnnotations('score-1')
    expect(fingeringFor(a, 'n1')).toBeUndefined()
    expect(notesForMeasure(a, 0)).toEqual([])
  })
})

describe('applyAnnotations', () => {
  it('changes exactly the annotated notes and nothing else', () => {
    const score = buildScore()
    const ids = score.notes.map((n) => n.id)
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: ids.length, maxLength: ids.length }),
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: ids.length, maxLength: ids.length }),
        (selected, fingers) => {
          const items: Annotation[] = []
          ids.forEach((id, i) => {
            if (selected[i] === true) {
              items.push({ kind: 'fingering', noteId: id, finger: fingers[i] as number })
            }
          })
          const a: ScoreAnnotations = { scoreId: score.id, items }
          const applied = applyAnnotations(score, a)

          expect(applied.notes).toHaveLength(score.notes.length)
          // Everything about the score other than `notes` is untouched.
          expect({ ...applied, notes: [] }).toEqual({ ...score, notes: [] })
          applied.notes.forEach((n: ScoreNote, i: number) => {
            const original = score.notes[i] as ScoreNote
            if (selected[i] === true) {
              expect(n.fingering).toBe(fingers[i])
              expect({ ...n, fingering: undefined }).toEqual({ ...original, fingering: undefined })
            } else {
              expect(n).toEqual(original)
            }
          })
        },
      ),
    )
  })

  it('returns the same score unchanged when there are no fingering annotations', () => {
    const score = buildScore()
    const a = setAnnotation(emptyAnnotations(score.id), {
      kind: 'highlight',
      noteId: score.notes[0]?.id ?? '',
      colour: 'red',
    })
    expect(applyAnnotations(score, a)).toEqual(score)
  })

  it('ignores a fingering annotation for a noteId absent from the score', () => {
    const score = buildScore()
    const a = setAnnotation(emptyAnnotations(score.id), {
      kind: 'fingering',
      noteId: 'no-such-note',
      finger: 3,
    })
    expect(applyAnnotations(score, a)).toEqual(score)
  })
})

describe('validateAnnotations', () => {
  it('accepts a well-formed value and round-trips distinct-noteId items', () => {
    // Deduplicate by (kind, noteId) before comparing: validateAnnotations
    // collapses duplicate fingering/highlight per noteId to the last one, per
    // the module's own invariant, so generated inputs with such duplicates
    // would not round-trip byte-for-byte.
    fc.assert(
      fc.property(
        fc.uniqueArray(annotationArb, {
          maxLength: 5,
          selector: (item) => (item.kind === 'note' ? item : `${item.kind}:${item.noteId}`),
        }),
        (items) => {
          const value = { scoreId: 'score-1', items }
          const result = validateAnnotations(value)
          expect(result.ok).toBe(true)
          expect(result.ok && result.value).toEqual({ scoreId: 'score-1', items })
        },
      ),
    )
  })

  it('rejects a non-object value', () => {
    for (const bad of [undefined, null, 42, 'nope', []]) {
      expect(validateAnnotations(bad).ok).toBe(false)
    }
  })

  it('rejects a missing or empty scoreId', () => {
    expect(validateAnnotations({ items: [] }).ok).toBe(false)
    expect(validateAnnotations({ scoreId: '', items: [] }).ok).toBe(false)
    expect(validateAnnotations({ scoreId: 123, items: [] }).ok).toBe(false)
  })

  it('rejects items that are not an array', () => {
    expect(validateAnnotations({ scoreId: 's', items: 'nope' }).ok).toBe(false)
    expect(validateAnnotations({ scoreId: 's' }).ok).toBe(false)
  })

  it('rejects an item with an unknown kind', () => {
    const value = { scoreId: 's', items: [{ kind: 'bogus', noteId: 'n1' }] }
    expect(validateAnnotations(value).ok).toBe(false)
  })

  it('rejects every single-field corruption of an otherwise-valid item', () => {
    const badValues: readonly unknown[] = [undefined, 123, {}, [], null, '']
    fc.assert(
      fc.property(annotationArb, fc.constantFrom(...badValues), (item, bad) => {
        const fields = Object.keys(item).filter((f) => f !== 'kind')
        for (const field of fields) {
          // A corruption value that happens to still satisfy the field's own
          // constraints would not actually be a corruption — skip those.
          if (field === 'finger' && typeof bad === 'number' && Number.isInteger(bad) && bad >= 1 && bad <= 5) {
            continue
          }
          if (
            (field === 'noteId' || field === 'colour' || field === 'text') &&
            typeof bad === 'string' &&
            bad.length > 0
          ) {
            continue
          }
          if (field === 'measureIndex' && typeof bad === 'number' && Number.isInteger(bad) && bad >= 0) {
            continue
          }
          const corrupted: Record<string, unknown> = { ...item, [field]: bad }
          const result = validateAnnotations({ scoreId: 's', items: [corrupted] })
          expect(result.ok).toBe(false)
        }
      }),
    )
  })

  it('rejects a corrupted scoreId even when every item is valid', () => {
    const badScoreIds: readonly unknown[] = [undefined, 123, {}, [], null, '']
    fc.assert(
      fc.property(fc.array(annotationArb, { maxLength: 3 }), fc.constantFrom(...badScoreIds), (items, bad) => {
        expect(validateAnnotations({ scoreId: bad, items }).ok).toBe(false)
      }),
    )
  })
})
