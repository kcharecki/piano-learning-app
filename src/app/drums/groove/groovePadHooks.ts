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
import type { PadFlash } from './useGrooveRun.ts'

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
 * Binds the pad keys on `document`, so a learner never has to keep a pad
 * focused to play it. See the module comment for why Space alone is gated on
 * the run phase.
 */
export function useKeyboardPads(
  pads: readonly MappedDrumPad[],
  hit: (pad: MappedDrumPad) => void,
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
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
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
      hitRef.current(pad)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [byKey])
}
