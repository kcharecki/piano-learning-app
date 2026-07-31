/**
 * Randomness port. The sight-reading generator, drill pickers and SRS jitter all
 * take an `Rng`, so any generated exercise can be reproduced exactly from its
 * seed — which is what makes generator tests meaningful rather than smoke tests.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
}

/** Uniform integer in [min, max] inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
  if (max < min) throw new RangeError(`randomInt: max ${max} < min ${min}`)
  return min + Math.floor(rng.next() * (max - min + 1))
}

/** Pick one element. Throws on an empty array (programmer error). */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: empty array')
  return items[randomInt(rng, 0, items.length - 1)] as T
}

/**
 * Pick one element by relative weight. Weights need not sum to 1; non-positive
 * weights are skipped. Used for rhythm-value distributions in the generator.
 */
export function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + Math.max(0, w), 0)
  if (total <= 0) throw new RangeError('pickWeighted: no positive weights')
  let roll = rng.next() * total
  for (const [item, weight] of items) {
    if (weight <= 0) continue
    roll -= weight
    if (roll < 0) return item
  }
  // Only reachable through float accumulation error; return the last positive one.
  return items[items.length - 1]![0]
}

/** Fisher–Yates, returning a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i)
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/**
 * mulberry32 — small, fast, well-distributed 32-bit PRNG. Deterministic from a
 * seed, so the same seed always yields the same exercise. Used in production
 * *and* in tests; there is no separate "fake" random.
 */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}
