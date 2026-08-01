import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { FakeClock } from '@test/fakes.ts'
import { buildTestScore } from '@core/notation/fixtures.ts'
import type { AssessmentResult } from '@core/practice/assessment.ts'
import { isRetired, retire, SightReadingSession, type SightReadingRecord } from './session.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const testScore = (id = 'piece-1') => buildTestScore([{ midi: 60, startTick: 0 }], { id })

/** A passing-looking assessment. `accuracy` is the only field these tests read. */
const testAssessment = (accuracy: number): AssessmentResult => ({
  scoreId: 'piece-1',
  accuracy,
  timingConsistency: 1,
  meanAbsDeviationMs: 0,
  tempoBpm: 120,
  measures: [],
  counts: { correct: 1, wrongPitch: 0, missed: 0, extra: 0 },
  completedAt: 0,
})

/** A fresh session, previewMs made explicit so boundary tests never depend on the default. */
const newSession = (
  clock: FakeClock,
  opts: { readonly previewMs?: number; readonly level?: number; readonly scoreId?: string } = {},
): SightReadingSession =>
  new SightReadingSession({
    score: testScore(opts.scoreId),
    clock,
    previewMs: opts.previewMs ?? 1000,
    level: opts.level ?? 2,
  })

// ---------------------------------------------------------------------------
// phase machine
// ---------------------------------------------------------------------------

describe('SightReadingSession phases', () => {
  it('starts idle with the full preview window still ahead of it', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    expect(session.phase).toBe('idle')
    expect(session.previewRemainingMs).toBe(1000)
  })

  it('defaults previewMs to 30_000 (REQ-3.4.4) when not given', () => {
    const clock = new FakeClock()
    const session = new SightReadingSession({ score: testScore(), clock, level: 1 })
    expect(session.previewRemainingMs).toBe(30_000)
  })

  it('beginPreview moves idle -> preview and starts the countdown from now', () => {
    const clock = new FakeClock(500)
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    expect(session.phase).toBe('preview')
    expect(session.previewRemainingMs).toBe(1000)
    clock.advance(400)
    expect(session.previewRemainingMs).toBe(600)
  })

  it('beginPreview a second time throws — preview cannot be re-entered', () => {
    const clock = new FakeClock()
    const session = newSession(clock)
    session.beginPreview()
    expect(() => session.beginPreview()).toThrow()
    expect(session.phase).toBe('preview')
  })

  it('beginPlaying from idle throws — playing cannot skip past a preview that never started', () => {
    const clock = new FakeClock()
    const session = newSession(clock)
    expect(() => session.beginPlaying()).toThrow()
    expect(session.phase).toBe('idle')
  })

  it('beginPlaying during preview ends it early, before the timer expires', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    clock.advance(200)
    session.beginPlaying()
    expect(session.phase).toBe('playing')
    expect(session.previewRemainingMs).toBe(0)
  })

  it('beginPlaying a second time throws — playing cannot start twice, and there is no way back to preview', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    session.beginPlaying()
    expect(() => session.beginPlaying()).toThrow()
    expect(session.phase).toBe('playing')
  })

  it('beginPlaying after finish also throws — finishing does not reopen playing', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    session.beginPlaying()
    session.finish(testAssessment(0.9))
    expect(() => session.beginPlaying()).toThrow()
    expect(session.phase).toBe('finished')
  })

  it('update() during preview is a no-op strictly before the boundary', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    clock.advance(999)
    session.update()
    expect(session.phase).toBe('preview')
    expect(session.previewRemainingMs).toBe(1)
  })

  it('update() ends the preview exactly at the boundary, not before or after it', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    clock.advance(1000)
    expect(session.phase).toBe('preview') // update() has not been pumped yet
    session.update()
    expect(session.phase).toBe('playing')
    expect(session.previewRemainingMs).toBe(0)
  })

  it('update() past the boundary (a late pump) still ends the preview, never goes negative', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 1000 })
    session.beginPreview()
    clock.advance(5000)
    session.update()
    expect(session.phase).toBe('playing')
    expect(session.previewRemainingMs).toBe(0)
  })

  it('a zero-length preview ends on the very first update()', () => {
    const clock = new FakeClock()
    const session = newSession(clock, { previewMs: 0 })
    session.beginPreview()
    expect(session.phase).toBe('preview')
    session.update()
    expect(session.phase).toBe('playing')
  })

  it('update() is a no-op in idle, playing and finished — it can only ever end a preview', () => {
    const clock = new FakeClock()
    const idle = newSession(clock, { previewMs: 1000 })
    idle.update()
    expect(idle.phase).toBe('idle')

    const playing = newSession(clock, { previewMs: 1000 })
    playing.beginPreview()
    playing.beginPlaying()
    playing.update()
    expect(playing.phase).toBe('playing')

    const finished = newSession(clock, { previewMs: 1000 })
    finished.beginPreview()
    finished.beginPlaying()
    finished.finish(testAssessment(0.9))
    finished.update()
    expect(finished.phase).toBe('finished')
  })

  it('finish() before playing (from idle or preview) throws', () => {
    const clock = new FakeClock()
    const fromIdle = newSession(clock)
    expect(() => fromIdle.finish(testAssessment(0.9))).toThrow()

    const fromPreview = newSession(clock)
    fromPreview.beginPreview()
    expect(() => fromPreview.finish(testAssessment(0.9))).toThrow()
  })

  it('finish() a second time throws — the record cannot be produced twice', () => {
    const clock = new FakeClock()
    const session = newSession(clock)
    session.beginPreview()
    session.beginPlaying()
    session.finish(testAssessment(0.9))
    expect(() => session.finish(testAssessment(0.9))).toThrow()
  })

  it('finish() moves to finished and stamps a record from the score, clock and assessment', () => {
    const clock = new FakeClock(1_000)
    const session = newSession(clock, { previewMs: 1000, level: 4, scoreId: 'sonatina-1' })
    session.beginPreview()
    clock.advance(200)
    session.beginPlaying()
    clock.advance(30_000)
    const record = session.finish(testAssessment(0.87))
    expect(session.phase).toBe('finished')
    expect(record).toEqual({
      pieceId: 'sonatina-1',
      readAt: 1_000 + 200 + 30_000,
      accuracy: 0.87,
      level: 4,
    })
  })
})

// ---------------------------------------------------------------------------
// retirement pool (REQ-3.4.3)
// ---------------------------------------------------------------------------

const record = (pieceId: string): SightReadingRecord => ({
  pieceId,
  readAt: 0,
  accuracy: 0.85,
  level: 1,
})

describe('isRetired / retire', () => {
  it('nothing is retired against an empty history', () => {
    expect(isRetired([], 'anything')).toBe(false)
  })

  it('retire never mutates the history it is given', () => {
    const before: readonly SightReadingRecord[] = [record('a')]
    const after = retire(before, record('b'))
    expect(before).toEqual([record('a')])
    expect(after).toEqual([record('a'), record('b')])
    expect(after).not.toBe(before)
  })

  it('a piece is retired the instant it is retired, and never un-retires', () => {
    let history: readonly SightReadingRecord[] = []
    expect(isRetired(history, 'p1')).toBe(false)
    history = retire(history, record('p1'))
    expect(isRetired(history, 'p1')).toBe(true)
    history = retire(history, record('p2'))
    expect(isRetired(history, 'p1')).toBe(true)
    expect(isRetired(history, 'p2')).toBe(true)
  })

  it('property: after retiring a sequence of distinct ids, every one seen so far is retired and none unseen is', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 30 }),
        (ids) => {
          let history: readonly SightReadingRecord[] = []
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i] as string
            history = retire(history, record(id))
            for (let j = 0; j <= i; j++) expect(isRetired(history, ids[j] as string)).toBe(true)
            for (let j = i + 1; j < ids.length; j++)
              expect(isRetired(history, ids[j] as string)).toBe(false)
          }
          expect(history.length).toBe(ids.length)
        },
      ),
    )
  })
})
