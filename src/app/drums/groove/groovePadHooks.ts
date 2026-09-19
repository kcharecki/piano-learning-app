/**
 * The hooks that go with `GrooveControls.tsx`'s pads (roadmap DR-09), shared
 * by every screen built on `useGrooveRun`. `useKeyboardPads` binds the pad
 * keys on `document`, gating Space alone on `running` so starting a run with
 * the mouse never turns the learner's first kick into a second press of Start
 * — see `GrooveTrainerScreen.tsx`'s module comment for the full reasoning.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { PAD_FLASH_MS } from './GrooveControls.tsx'
import { GROOVE_PAD_KEY } from './padLabels.ts'
import { HIT_VELOCITY, type PadFlash } from './useGrooveRun.ts'

/**
 * The velocity a PLAIN keyboard tap (no Shift/Alt) simulates — review round 3,
 * RED 3. Re-exports `useGrooveRun.ts`'s own `HIT_VELOCITY` under this name
 * rather than a second, hand-typed `96`, so there is exactly ONE canonical
 * "plain press" velocity and the two modules can never drift apart.
 * `velocityClassOf(KEYBOARD_NORMAL_VELOCITY) === 'normal'` is pinned by a test
 * against this constant, never a typed number.
 */
export const KEYBOARD_NORMAL_VELOCITY = HIT_VELOCITY

/** Lights a pad for `PAD_FLASH_MS` each time `flash` changes — the "it registered" signal. */
export function useFlash(flash: PadFlash | undefined): MappedDrumPad | undefined {
  const [lit, setLit] = useState<MappedDrumPad | undefined>(undefined)
  useEffect(() => {
    if (flash === undefined) return undefined
    setLit(flash.pad)
    const timer = window.setTimeout(() => setLit(undefined), PAD_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])
  return lit
}

/**
 * DR-07 tail / DR-03: the velocity a keyboard tap simulates when held with a
 * modifier — Shift for an accent, Alt for a ghost note — so a learner without
 * a velocity-sensitive pad can still practise dynamics. Picked well clear of
 * `DEFAULT_VELOCITY_THRESHOLDS` on either side (`velocityClassOf` classifies
 * both, pinned in this module's own test) rather than at a boundary value.
 */
export const KEYBOARD_ACCENT_VELOCITY = 110
export const KEYBOARD_GHOST_VELOCITY = 40

// BACKLOG (review round 3, item e — comment only, no behaviour change here):
// macOS rewrites `event.key` under Option+letter (Option+F -> "ƒ", not "f"),
// so `byKey.get(event.key.toLowerCase())` below never matches and the ghost
// modifier is silently dead on a Mac keyboard. `event.code` (e.g. "KeyF") is
// layout- and modifier-independent and would fix it, but that is a second,
// separate change (`GROOVE_PAD_KEY` and `byKey` are keyed by `event.key`
// today) — flagged for its own slice, not folded into this one.

/**
 * Binds the pad keys on `document`, so a learner never has to keep a pad
 * focused to play it. See the module comment for why Space alone is gated on
 * the run phase. Shift simulates an accent, Alt a ghost note (DR-07 tail /
 * DR-03). A plain keydown passes `KEYBOARD_NORMAL_VELOCITY` explicitly
 * (review round 3, RED 3) — a keyboard press ALWAYS carries a velocity,
 * unlike a mouse click on an on-screen pad, which carries none at all and is
 * graded as unclassified (see `dynamics.ts`); passing it explicitly, rather
 * than omitting the argument, is what keeps a keyboard-played run's dynamics
 * gradeable even when every press is unmodified.
 */
export function useKeyboardPads(
  pads: readonly MappedDrumPad[],
  hit: (pad: MappedDrumPad, velocity?: number) => void,
  running: boolean,
): void {
  const hitRef = useRef(hit)
  hitRef.current = hit
  const runningRef = useRef(running)
  runningRef.current = running

  const byKey = useMemo(() => {
    const map = new Map<string, MappedDrumPad>()
    for (const pad of pads) {
      const key = GROOVE_PAD_KEY[pad]
      if (key !== undefined) map.set(key, pad)
    }
    return map
  }, [pads])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Alt no longer bails here (DR-07 tail) — it now simulates a ghost
      // note, below. Ctrl/meta/repeat are still not this feature's business:
      // a repeat is the OS's own key-repeat, not a second stroke, and
      // ctrl/meta combos are the browser's/OS's own shortcuts to leave alone.
      if (event.repeat || event.ctrlKey || event.metaKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      const pad = byKey.get(event.key.toLowerCase())
      if (pad === undefined) return
      if (event.key === ' ') {
        if (!runningRef.current) return
        event.preventDefault()
      }
      if (event.altKey) {
        // Prevented so the combo never triggers the browser's own menu key
        // behaviour (Alt alone does, in most browsers) while ghost-tapping —
        // but only while a run is actually accepting the hit (amber, review
        // round 3): scoped to `running` so Alt+F/Alt+D etc. still reach the
        // browser's own shortcuts while idle, exactly as they did before
        // ghost-tapping existed. `hit()` itself already no-ops outside a run
        // (see `useGrooveRun.ts`), so nothing is lost by only suppressing the
        // browser default when the tap can land.
        if (runningRef.current) event.preventDefault()
        hitRef.current(pad, KEYBOARD_GHOST_VELOCITY)
        return
      }
      if (event.shiftKey) {
        hitRef.current(pad, KEYBOARD_ACCENT_VELOCITY)
        return
      }
      hitRef.current(pad, KEYBOARD_NORMAL_VELOCITY)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [byKey])
}
