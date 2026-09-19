/**
 * The groove trainer's reusable controls (roadmap DR-09), split out of
 * `GrooveTrainerScreen.tsx` so the coordination trainer (DR-15) and any later
 * screen built on `useGrooveRun` share one pad, one tempo stepper and one
 * keyboard binding instead of copying them. Behaviour is unchanged from the
 * screen it came from; the module comments there still explain the why.
 *
 * `Pad` dispatches on `pointerdown` — a drum stroke happens when the stick
 * lands, and waiting for mouseup adds the learner's own release time to every
 * measurement. The two hooks that go with these (`useFlash`, `useKeyboardPads`)
 * live in `groovePadHooks.ts`, since a component file may export only
 * components for fast refresh.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import type { LiveHitKind } from '@core/drums/practice/liveHit.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { MAX_BPM, MIN_BPM, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { GROOVE_PAD_KEY, GROOVE_PAD_LABEL, keyLabel } from './padLabels.ts'

/** How long a struck pad stays lit. Long enough to see at sixteenths, short enough not to smear. */
export const PAD_FLASH_MS = 90

export type PadProps = {
  readonly pad: MappedDrumPad
  readonly lit: boolean
  readonly onHit: (pad: MappedDrumPad) => void
  /**
   * The live verdict (roadmap DR-09 "per-hit live feedback") for the hit that
   * most recently struck THIS pad, rendered as `data-verdict` for
   * `feature-drums-groove.css` to colour. Optional — undefined until this pad
   * has been struck at all, and the screen only ever passes it for the pad
   * `useGrooveRun.lastHit` names, so an old verdict never lingers on a pad
   * that was not the one just hit.
   */
  readonly verdict?: LiveHitKind
  /**
   * Rendered as `data-muted="true"` (roadmap DR-09 "per-limb mute") — the pad
   * still fires `onHit`, since a muted pad still sounds and flashes when
   * struck; only grading ignores it, and that decision lives entirely in
   * `useGrooveRun`, not here.
   */
  readonly muted?: boolean
  /**
   * Rendered as `data-required="true"` (roadmap DR-09 "wait mode") — the
   * screen passes this for exactly the pads the current wait step is still
   * waiting on, so the learner can see what to hit next without reading the
   * status line. Purely a display hint: `onHit` fires the same regardless.
   */
  readonly required?: boolean
}

/**
 * `pointerdown` is the stroke; the `click` handler is the keyboard path only.
 * A mouse press fires both, so the ref swallows the click that follows its own
 * pointerdown rather than counting the stroke twice.
 */
export function Pad({ pad, lit, onHit, verdict, muted, required }: PadProps) {
  const fromPointer = useRef(false)
  const key = GROOVE_PAD_KEY[pad]
  return (
    <button
      type="button"
      className="drum-pad"
      aria-label={GROOVE_PAD_LABEL[pad]}
      data-lit={lit ? 'true' : undefined}
      data-verdict={verdict}
      data-muted={muted ? 'true' : undefined}
      data-required={required ? 'true' : undefined}
      onPointerDown={() => {
        fromPointer.current = true
        onHit(pad)
      }}
      onClick={() => {
        if (fromPointer.current) {
          fromPointer.current = false
          return
        }
        onHit(pad)
      }}
    >
      <span className="drum-pad-name" aria-hidden="true">
        {GROOVE_PAD_LABEL[pad]}
      </span>
      {key !== undefined && (
        <span className="drum-pad-key" aria-hidden="true">
          {keyLabel(key)}
        </span>
      )}
    </button>
  )
}

export type DynamicsLegendProps = {
  readonly plan: GrooveRunPlan
}

/**
 * "Shift = accent · Alt = ghost" (review round 3, RED 3): the on-screen pads
 * (`Pad`, above) carry no velocity of their own — a mouse click on `hit(pad)`
 * records none at all (see `dynamics.ts`'s unclassified-not-normal rule) — so
 * a mouse learner on a dynamics-notated groove (Ghost-Funk Bar) has no way to
 * discover the keyboard fallback exists (`groovePadHooks.ts`'s
 * `KEYBOARD_ACCENT_VELOCITY`/`KEYBOARD_GHOST_VELOCITY`) and is left reading
 * "16 of 16 ghost notes came out full" with no way to fix it.
 *
 * Hidden for a plan with no non-'normal' `expectedDynamics` at all (e.g.
 * Money Beat, Quarter-Note Rock) — printing a dynamics hint there would be
 * pointing at a control that changes nothing.
 *
 * `--text-3` reused directly under a new class, the same pattern
 * `.groove-latency-note`/`.groove-graded-at` already use in
 * `feature-drums-groove.css` — this design system has no shared `.muted`
 * primitive (see `feature-drums-progress.css`'s module comment).
 */
export function DynamicsLegend({ plan }: DynamicsLegendProps) {
  const hasDynamics = plan.pads.some((pad) => pad.expectedDynamics.some((dynamics) => dynamics !== 'normal'))
  if (!hasDynamics) return null
  return <p className="groove-dynamics-legend">Shift = accent · Alt = ghost</p>
}

export type TempoFieldProps = {
  readonly bpm: number
  readonly onBpm: (bpm: number) => void
  readonly disabled: boolean
}

/**
 * The same typeable `.stepper` `MetronomeScreen` uses, and held as a draft
 * string for the same reason: typing "70" passes through "7", which clamps to
 * MIN_BPM and rewrites the field under the caret. Commit is blur or Enter.
 */
export function TempoField({ bpm, onBpm, disabled }: TempoFieldProps) {
  const inputId = useId()
  const [draft, setDraft] = useState(String(bpm))
  useEffect(() => {
    setDraft(String(bpm))
  }, [bpm])

  function commit(): void {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isNaN(parsed)) {
      setDraft(String(bpm))
      return
    }
    const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, parsed))
    setDraft(String(clamped))
    onBpm(clamped)
  }

  return (
    <div className="field groove-tempo-field">
      <label htmlFor={inputId}>Tempo</label>
      <div className="stepper">
        <button
          type="button"
          aria-label="Slower"
          disabled={disabled || bpm <= MIN_BPM}
          onClick={() => onBpm(bpm - 1)}
        >
          <Icon name="minus" />
        </button>
        <input
          id={inputId}
          className="stepper-value"
          type="number"
          inputMode="numeric"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          disabled={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setDraft(String(bpm))
            }
          }}
        />
        <button
          type="button"
          aria-label="Faster"
          disabled={disabled || bpm >= MAX_BPM}
          onClick={() => onBpm(bpm + 1)}
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  )
}
