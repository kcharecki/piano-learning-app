import { describe, expect, it } from 'vitest'
import { isWebMidiSupported } from './capability.ts'

describe('isWebMidiSupported', () => {
  it('is false when requestMIDIAccess is absent', () => {
    expect(isWebMidiSupported({})).toBe(false)
  })

  it('is false when requestMIDIAccess is present but not a function', () => {
    expect(isWebMidiSupported({ requestMIDIAccess: 'nope' })).toBe(false)
  })

  it('is true when requestMIDIAccess is a function', () => {
    expect(isWebMidiSupported({ requestMIDIAccess: () => Promise.resolve() })).toBe(true)
  })

  it('falls back to the real navigator when none is given', () => {
    // jsdom/happy-dom ship no Web MIDI implementation.
    expect(isWebMidiSupported()).toBe(false)
  })
})
