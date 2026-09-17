/**
 * `startLadder`/`recordPass` drive a metronome bpm from a stream of
 * pass/fail attempts. The example tests pin down each named ending
 * (plateau/ceiling/floor/completed); the property test is what actually
 * defends the invariants DR-10 cares about — this state machine gets called
 * on every single practice attempt, so a boundary bug would show up as a
 * silently-stuck or silently-skipping ladder rather than a crash.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { recordPass, startLadder, type TempoLadderConfig, type TempoLadderState } from './tempoLadder.ts'

describe('startLadder', () => {
  it('starts clamped, at direction up, with empty history', () => {
    const state = startLadder({ startBpm: 60 })
    expect(state).toEqual({
      bpm: 60,
      direction: 'up',
      cleanStreak: 0,
      failStreak: 0,
      bestCleanBpm: undefined,
      history: [],
      done: false,
    })
  })

  it('clamps a startBpm outside [min, max]', () => {
    expect(startLadder({ startBpm: 10, minBpm: 40, maxBpm: 200 }).bpm).toBe(40)
    expect(startLadder({ startBpm: 999, minBpm: 40, maxBpm: 200 }).bpm).toBe(200)
  })
})

describe('recordPass — named endings', () => {
  it('steps up after passesToAdvance clean passes, and back down on a fail', () => {
    const config: TempoLadderConfig = { startBpm: 60, stepBpm: 5, passesToAdvance: 2 }
    let state = startLadder(config)
    state = recordPass(state, true, config)
    expect(state.bpm).toBe(60) // first of two, no step yet
    expect(state.cleanStreak).toBe(1)
    state = recordPass(state, true, config)
    expect(state.bpm).toBe(65) // second clean pass completes the streak
    expect(state.cleanStreak).toBe(0)
    state = recordPass(state, false, config)
    expect(state.bpm).toBe(60) // a single fail steps straight back down
    expect(state.failStreak).toBe(1)
  })

  it('ends as plateau after failsToPlateau consecutive fails', () => {
    const config: TempoLadderConfig = { startBpm: 100, minBpm: 40, stepBpm: 5, failsToPlateau: 3 }
    let state = startLadder(config)
    state = recordPass(state, false, config)
    state = recordPass(state, false, config)
    expect(state.done).toBe(false)
    state = recordPass(state, false, config)
    expect(state).toMatchObject({ done: true, reason: 'plateau', bpm: 85 })
  })

  it('ends as ceiling on a clean streak completed at maxBpm in "up" mode', () => {
    const config: TempoLadderConfig = { startBpm: 100, maxBpm: 100, passesToAdvance: 2, mode: 'up' }
    let state = startLadder(config)
    state = recordPass(state, true, config)
    expect(state.done).toBe(false)
    state = recordPass(state, true, config)
    expect(state).toMatchObject({ done: true, reason: 'ceiling', bpm: 100 })
  })

  it('ends as floor on a fail while already sitting at minBpm', () => {
    const config: TempoLadderConfig = { startBpm: 40, minBpm: 40 }
    let state = startLadder(config)
    state = recordPass(state, false, config)
    expect(state).toMatchObject({ done: true, reason: 'floor', bpm: 40 })
  })

  it('"up-then-down" flips at the ceiling and ends completed back at startBpm', () => {
    const config: TempoLadderConfig = {
      startBpm: 60,
      maxBpm: 65,
      minBpm: 40,
      stepBpm: 5,
      passesToAdvance: 1,
      mode: 'up-then-down',
    }
    let state = startLadder(config)
    state = recordPass(state, true, config)
    expect(state).toMatchObject({ bpm: 65, direction: 'up', done: false })
    state = recordPass(state, true, config)
    expect(state).toMatchObject({ bpm: 65, direction: 'down', done: false })
    state = recordPass(state, true, config)
    expect(state).toMatchObject({ bpm: 60, direction: 'down', done: false })
    state = recordPass(state, true, config)
    expect(state).toMatchObject({ bpm: 60, direction: 'down', done: true, reason: 'completed' })
  })

  it('is absorbing once done', () => {
    const config: TempoLadderConfig = { startBpm: 40, minBpm: 40 }
    const done = recordPass(startLadder(config), false, config)
    expect(done.done).toBe(true)
    expect(recordPass(done, true, config)).toBe(done)
    expect(recordPass(done, false, config)).toBe(done)
  })

  it('bestCleanBpm tracks the highest bpm a clean pass was recorded at', () => {
    const config: TempoLadderConfig = { startBpm: 60, stepBpm: 5, passesToAdvance: 1 }
    let state = startLadder(config)
    expect(state.bestCleanBpm).toBeUndefined()
    state = recordPass(state, true, config) // clean at 60
    expect(state.bestCleanBpm).toBe(60)
    state = recordPass(state, false, config) // fail at 65, drops to 60
    expect(state.bestCleanBpm).toBe(60)
    state = recordPass(state, true, config) // clean at 60 again — not a new PR
    expect(state.bestCleanBpm).toBe(60)
  })
})

describe('recordPass — property', () => {
  const configArb = fc
    .record({
      minBpm: fc.integer({ min: 20, max: 60 }),
      spread: fc.integer({ min: 10, max: 200 }),
      startOffset: fc.integer({ min: 0, max: 1000 }),
      stepBpm: fc.integer({ min: 1, max: 10 }),
      passesToAdvance: fc.integer({ min: 1, max: 4 }),
      failsToPlateau: fc.integer({ min: 1, max: 4 }),
      mode: fc.constantFrom<'up' | 'up-then-down'>('up', 'up-then-down'),
    })
    .map(({ minBpm, spread, startOffset, ...rest }): TempoLadderConfig => {
      const maxBpm = minBpm + spread
      const startBpm = minBpm + (startOffset % (spread + 1))
      return { startBpm, minBpm, maxBpm, ...rest }
    })

  it('bpm stays in range, steps by at most stepBpm, bestCleanBpm never drops, history matches the passes recorded, and done is absorbing', () => {
    fc.assert(
      fc.property(configArb, fc.array(fc.boolean(), { maxLength: 60 }), (config, passes) => {
        let state = startLadder(config)
        expect(state.bpm).toBeGreaterThanOrEqual(config.minBpm as number)
        expect(state.bpm).toBeLessThanOrEqual(config.maxBpm as number)

        let recorded = 0
        for (const clean of passes) {
          const previous: TempoLadderState = state
          state = recordPass(previous, clean, config)

          if (previous.done) {
            expect(state).toBe(previous)
            continue
          }
          recorded += 1

          expect(state.bpm).toBeGreaterThanOrEqual(config.minBpm as number)
          expect(state.bpm).toBeLessThanOrEqual(config.maxBpm as number)
          expect(Math.abs(state.bpm - previous.bpm)).toBeLessThanOrEqual(config.stepBpm as number)

          if (previous.bestCleanBpm !== undefined) {
            expect(state.bestCleanBpm).toBeDefined()
            expect(state.bestCleanBpm as number).toBeGreaterThanOrEqual(previous.bestCleanBpm)
          }
          if (clean) {
            expect(state.bestCleanBpm).toBeDefined()
          }
          expect(state.history).toHaveLength(recorded)
        }
      }),
    )
  })
})
