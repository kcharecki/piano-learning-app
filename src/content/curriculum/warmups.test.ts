/**
 * Proves the warm-up content (roadmap 5.45) is real, not a label:
 * `WARMUP_STEPS` is a genuine away-from-the-keys checklist (no keyboard,
 * finger-number, or note-reading language — that would just be a technique
 * drill with extra steps) and `WARMUP_EXERCISE` is a well-formed `Exercise`
 * that `@core/curriculum/session.ts`'s `fillSegment` can actually consume.
 */
import { describe, expect, it } from 'vitest'
import { WARMUP_EXERCISE, WARMUP_EXERCISE_ID, WARMUP_STEPS } from './warmups.ts'

describe('WARMUP_STEPS', () => {
  it('is a non-empty checklist of distinct, non-blank instructions', () => {
    expect(WARMUP_STEPS.length).toBeGreaterThan(0)
    for (const step of WARMUP_STEPS) {
      expect(step.id.trim().length).toBeGreaterThan(0)
      expect(step.instruction.trim().length).toBeGreaterThan(0)
    }
    const ids = WARMUP_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stays away from the keys — no keyboard, note-reading or fingering language', () => {
    // The point of 5.45 (per every source consulted, Juilliard's routine
    // named specifically) is that warm-up happens BEFORE the learner
    // touches the instrument. A step that mentions keys, notes or fingering
    // numbers would just be an unlabelled technique drill.
    const bannedWords = /\bkeys?\b|\bkeyboard\b|\bnote[s]?\b|\bfinger(ing)?\s*\d|\bmiddle c\b/i
    for (const step of WARMUP_STEPS) {
      expect(step.instruction).not.toMatch(bannedWords)
    }
  })
})

describe('WARMUP_EXERCISE', () => {
  it('is well-formed and matches WARMUP_EXERCISE_ID', () => {
    expect(WARMUP_EXERCISE.id).toBe(WARMUP_EXERCISE_ID)
    expect(WARMUP_EXERCISE.title.trim().length).toBeGreaterThan(0)
    expect(Number.isFinite(WARMUP_EXERCISE.estimatedMinutes)).toBe(true)
    expect(WARMUP_EXERCISE.estimatedMinutes).toBeGreaterThan(0)
  })
})
