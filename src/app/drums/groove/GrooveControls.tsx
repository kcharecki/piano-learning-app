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
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { MAX_BPM, MIN_BPM } from '@core/drums/practice/plan.ts'
import { GROOVE_PAD_KEY, GROOVE_PAD_LABEL, keyLabel } from './padLabels.ts'

/** How long a struck pad stays lit. Long enough to see at sixteenths, short enough not to smear. */
export const PAD_FLASH_MS = 90

export type PadProps = {
  readonly pad: MappedDrumPad
  readonly lit: boolean
  readonly onHit: (pad: MappedDrumPad) => void
}

/**
 * `pointerdown` is the stroke; the `click` handler is the keyboard path only.
 * A mouse press fires both, so the ref swallows the click that follows its own
 * pointerdown rather than counting the stroke twice.
 */
export function Pad({ pad, lit, onHit }: PadProps) {
  const fromPointer = useRef(false)
  const key = GROOVE_PAD_KEY[pad]
  return (
    <button
      type="button"
      className="drum-pad"
      aria-label={GROOVE_PAD_LABEL[pad]}
      data-lit={lit ? 'true' : undefined}
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
