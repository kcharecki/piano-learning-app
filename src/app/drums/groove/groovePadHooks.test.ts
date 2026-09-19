/**
 * `useKeyboardPads` — DR-07 tail / DR-03 added Shift/Alt as a velocity
 * fallback for learners without a velocity-sensitive pad. Pinned here: plain
 * key -> `KEYBOARD_NORMAL_VELOCITY` explicitly (review round 3, RED 3 — a
 * keyboard tap always carries a velocity, unlike a mouse click), Shift ->
 * `KEYBOARD_ACCENT_VELOCITY`, Alt -> `KEYBOARD_GHOST_VELOCITY`, and that
 * ctrl/meta/repeat still bail exactly as before Alt was freed up. Also pins
 * the amber fix scoping Alt's `preventDefault` to a running drill, so
 * Alt+letter still reaches the browser's own shortcuts while idle.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { velocityClassOf } from '@core/drums/model/velocity.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import {
  KEYBOARD_ACCENT_VELOCITY,
  KEYBOARD_GHOST_VELOCITY,
  KEYBOARD_NORMAL_VELOCITY,
  useKeyboardPads,
} from './groovePadHooks.ts'

const PADS: readonly MappedDrumPad[] = ['hhClosed', 'hhOpen', 'snare', 'kick', 'hhPedal']

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

function mountKeyboardPads(hit: (pad: MappedDrumPad, velocity?: number) => void, running = true): void {
  renderHook(() => useKeyboardPads(PADS, hit, running))
}

describe('KEYBOARD_ACCENT_VELOCITY / KEYBOARD_GHOST_VELOCITY / KEYBOARD_NORMAL_VELOCITY', () => {
  it('classify as accent, ghost, and normal respectively — the whole point of picking them', () => {
    expect(velocityClassOf(KEYBOARD_ACCENT_VELOCITY)).toBe('accent')
    expect(velocityClassOf(KEYBOARD_GHOST_VELOCITY)).toBe('ghost')
    // Against the exported constant, not a hand-typed 96 (review round 3, RED 3).
    expect(velocityClassOf(KEYBOARD_NORMAL_VELOCITY)).toBe('normal')
  })
})

describe('useKeyboardPads: velocity modifiers (DR-07 tail / DR-03)', () => {
  it('a plain key press calls hit with KEYBOARD_NORMAL_VELOCITY explicitly', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit)
    press('f')
    // Review round 3, RED 3: a keyboard tap always carries a velocity — it is
    // NOT the same input shape as a mouse click, which gives none at all and
    // is graded as unclassified. Passing it explicitly (not omitting the
    // argument) is what keeps a keyboard-played run's dynamics gradeable.
    expect(hit).toHaveBeenCalledExactlyOnceWith('snare', KEYBOARD_NORMAL_VELOCITY)
  })

  it('Shift plays the pad at KEYBOARD_ACCENT_VELOCITY', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit)
    press('j', { shiftKey: true })
    expect(hit).toHaveBeenCalledExactlyOnceWith('hhClosed', KEYBOARD_ACCENT_VELOCITY)
  })

  it('Alt plays the pad at KEYBOARD_GHOST_VELOCITY and no longer bails', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit)
    press('f', { altKey: true })
    expect(hit).toHaveBeenCalledExactlyOnceWith('snare', KEYBOARD_GHOST_VELOCITY)
  })

  it('Alt prevents the browser default (menu-key activation) on a handled combo while running', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit, true)
    const event = new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  // Amber, review round 3: scoped to `running` so a learner not mid-drill
  // keeps their OS/browser Alt+letter shortcuts (e.g. Alt+F for a File menu).
  // `hit()` itself already no-ops outside a run, so the ghost tap is a no-op
  // either way — only the browser-default suppression changes.
  it('Alt does NOT prevent the browser default while idle, so Alt+letter still reaches the browser', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit, false)
    const event = new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('Alt is never treated as a bail condition even though it once was', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit)
    press('k', { altKey: true })
    expect(hit).toHaveBeenCalledTimes(1)
  })

  it('ctrl, meta and repeat still bail — none of them plays anything', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit)
    press('f', { ctrlKey: true })
    press('f', { metaKey: true })
    press('f', { repeat: true })
    expect(hit).not.toHaveBeenCalled()
  })

  it('a key with no pad bound does nothing, modifier or not', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit)
    press('q', { shiftKey: true })
    press('q', { altKey: true })
    expect(hit).not.toHaveBeenCalled()
  })

  it('Space (the kick) still only fires while running, exactly as before Shift/Alt were added', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit, false)
    press(' ')
    expect(hit).not.toHaveBeenCalled()
  })

  it('Space with Shift while running plays the kick at KEYBOARD_ACCENT_VELOCITY', () => {
    const hit = vi.fn()
    mountKeyboardPads(hit, true)
    press(' ', { shiftKey: true })
    expect(hit).toHaveBeenCalledExactlyOnceWith('kick', KEYBOARD_ACCENT_VELOCITY)
  })
})
