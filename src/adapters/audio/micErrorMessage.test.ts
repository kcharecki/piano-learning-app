import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeMicError } from './micErrorMessage.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('describeMicError', () => {
  it('logs the raw cause via console.warn but never returns it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cause = new DOMException('some raw browser detail', 'NotAllowedError')

    const message = describeMicError('someCaller', cause)

    expect(message).not.toMatch(/some raw browser detail/)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('someCaller'), cause)
  })

  it.each([
    ['NotFoundError', /no microphone was found/i],
    ['OverconstrainedError', /no microphone was found/i],
    ['NotReadableError', /already in use/i],
    ['NotAllowedError', /blocked microphone access/i],
    ['SecurityError', /blocked microphone access/i],
  ])('maps DOMException %s to distinct learner copy', (name, expected) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const message = describeMicError('ctx', new DOMException('detail', name))
    expect(message).toMatch(expected)
  })

  it('falls back to a generic actionable message for an unrecognised cause', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const message = describeMicError('ctx', new Error('getUserMedia is not available in this browser.'))
    expect(message).toMatch(/microphone access failed/i)
    expect(message).not.toMatch(/is not available in this browser/)
  })

  it('keeps distinct cases from colliding into the same string', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notFound = describeMicError('ctx', new DOMException('x', 'NotFoundError'))
    const refused = describeMicError('ctx', new DOMException('x', 'NotAllowedError'))
    const inUse = describeMicError('ctx', new DOMException('x', 'NotReadableError'))
    expect(new Set([notFound, refused, inUse]).size).toBe(3)
  })
})
