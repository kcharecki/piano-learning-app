/**
 * Proves the sight-reading trainer's level descriptions (roadmap U.1) are
 * real content, not a stub: every trainer level `1..MAX_GENERATOR_LEVEL` has
 * a distinct, non-empty description, and `sightReadingLevelDescription`
 * actually returns it. The module-load `invariant`s in `levelDescriptions.ts`
 * already fail the build if a level is missing one description entirely
 * (wrong array length) or has a blank one — this test additionally covers
 * per-level lookup and out-of-range clamping, which those invariants don't.
 */
import { describe, expect, it } from 'vitest'
import { MAX_GENERATOR_LEVEL } from '@core/generator/levelDefaults.ts'
import { sightReadingLevelDescription } from './levelDescriptions.ts'

const LEVELS = Array.from({ length: MAX_GENERATOR_LEVEL }, (_, i) => i + 1)

describe('sightReadingLevelDescription', () => {
  it('returns a non-empty, distinct description for every trainer level', () => {
    const descriptions = LEVELS.map(sightReadingLevelDescription)
    for (const description of descriptions) {
      expect(description.trim().length).toBeGreaterThan(0)
    }
    // Distinct: a level whose description was copy-pasted from its neighbour
    // would still pass "non-empty" but tells the learner nothing real about
    // THIS level.
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('clamps out-of-range levels instead of returning undefined', () => {
    expect(sightReadingLevelDescription(0)).toBe(sightReadingLevelDescription(1))
    expect(sightReadingLevelDescription(-5)).toBe(sightReadingLevelDescription(1))
    expect(sightReadingLevelDescription(MAX_GENERATOR_LEVEL + 1)).toBe(
      sightReadingLevelDescription(MAX_GENERATOR_LEVEL),
    )
    expect(sightReadingLevelDescription(999)).toBe(sightReadingLevelDescription(MAX_GENERATOR_LEVEL))
  })

  it('rounds a fractional level to the nearest whole level', () => {
    expect(sightReadingLevelDescription(2.4)).toBe(sightReadingLevelDescription(2))
    expect(sightReadingLevelDescription(2.6)).toBe(sightReadingLevelDescription(3))
  })

  it("does not name specific interval sizes or note values for levels 1-2 — 5.53/5.54 are re-grading those columns concurrently", () => {
    // Roadmap 5.53 (leap column, levels below 4) and 5.54 (rhythm, levels
    // 1-2) are in flight in sibling worktrees while this content is authored.
    // A description naming today's exact leap size or note value for levels
    // 1-2 would go stale the moment either lands, silently becoming false
    // content shown to a learner. This test is the guard: it fails loudly if
    // that wording creeps back in, rather than relying on a human noticing.
    const bannedForLevel1And2 = /\bwhole note|\bhalf note|\bquarter note|\bsemitone|\binterval of|\ba \w+th\b/i
    expect(sightReadingLevelDescription(1)).not.toMatch(bannedForLevel1And2)
    expect(sightReadingLevelDescription(2)).not.toMatch(bannedForLevel1And2)
  })
})
