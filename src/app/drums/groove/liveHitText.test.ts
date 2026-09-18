import { describe, expect, it } from 'vitest'
import type { LiveHitVerdict } from '@core/drums/practice/liveHit.ts'
import { liveHitText } from './liveHitText.ts'

function verdict(partial: Partial<LiveHitVerdict>): LiveHitVerdict {
  return {
    pad: 'snare',
    kind: 'on-time',
    offsetMs: 0,
    instantIndex: 0,
    ...partial,
  }
}

describe('liveHitText', () => {
  it('reads a small positive on-time offset with an explicit plus sign', () => {
    expect(liveHitText(verdict({ kind: 'on-time', offsetMs: 3 }))).toBe('Snare on time, +3 ms')
  })

  it('reads a negative on-time offset with its own minus sign', () => {
    expect(liveHitText(verdict({ kind: 'on-time', offsetMs: -3 }))).toBe('Snare on time, -3 ms')
  })

  it('reads exactly zero as +0 ms', () => {
    expect(liveHitText(verdict({ kind: 'on-time', offsetMs: 0 }))).toBe('Snare on time, +0 ms')
  })

  it('rounds a fractional offset to the nearest integer', () => {
    expect(liveHitText(verdict({ kind: 'on-time', offsetMs: 2.6 }))).toBe('Snare on time, +3 ms')
  })

  it('reads early without a sign on the number', () => {
    expect(liveHitText(verdict({ pad: 'kick', kind: 'early', offsetMs: -32 }))).toBe(
      'Kick early by 32 ms',
    )
  })

  it('reads late without a sign on the number', () => {
    expect(liveHitText(verdict({ pad: 'hhClosed', kind: 'late', offsetMs: 41 }))).toBe(
      'Hi-hat late by 41 ms',
    )
  })

  it('reads extra with no millisecond figure at all, since there is nothing to measure against', () => {
    expect(
      liveHitText(
        verdict({ pad: 'hhOpen', kind: 'extra', offsetMs: undefined, instantIndex: undefined }),
      ),
    ).toBe('Open hi-hat — nothing written there')
  })
})
