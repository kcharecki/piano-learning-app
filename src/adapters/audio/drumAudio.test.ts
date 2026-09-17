import { afterEach, describe, expect, it, vi } from 'vitest'

// `createDrumAudioOutput`/`createDrumAudioOutputWith` memoize a
// module-level singleton, so each test re-imports the module fresh (via
// `vi.resetModules()`) rather than sharing one singleton across tests.

describe('createDrumAudioOutput', () => {
  afterEach(() => {
    vi.resetModules()
  })

  // Kills a mutant that drops the memoization (builds a new `DrumAudioOutput`
  // — and so a new, gesture-losing `AudioContext` — on every call).
  it('createDrumAudioOutputWith memoizes: two calls return the same instance', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    // `createDrumSynth`'s `AudioContext` is built lazily on first strike/click,
    // so this factory is never actually invoked by just constructing the
    // output — no real (or fake) AudioContext needed here at all.
    const factory = () => {
      throw new Error('should not be called just to build the output')
    }

    const a = createDrumAudioOutputWith(factory)
    const b = createDrumAudioOutputWith(factory)
    expect(a).toBe(b)
  })

  // `createDrumAudioOutput` is the zero-arg default over the same seam.
  it('createDrumAudioOutput() also memoizes, with no context factory required', async () => {
    const { createDrumAudioOutput } = await import('@adapters/audio/drumAudio.ts')

    const a = createDrumAudioOutput()
    const b = createDrumAudioOutput()
    expect(a).toBe(b)
  })
})
