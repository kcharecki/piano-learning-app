/**
 * Hand mute (roadmap 1.18, REQ-3.2.3): left only, right only, or both. The
 * actual muting is `filterHands` from `@core/notation/score.ts`, applied by
 * `usePracticeEngine` to the score before it reaches the transport — this is
 * only the three-way switch that picks which hands stay active.
 */
import type { Hand } from '@core/notation/score.ts'

export type HandMuteControlProps = {
  readonly activeHands: readonly Hand[]
  readonly onChange: (hands: readonly Hand[]) => void
  /** Disables every option — e.g. while an assessment run is in progress. */
  readonly disabled?: boolean
}

const OPTIONS: readonly { readonly label: string; readonly hands: readonly Hand[] }[] = [
  { label: 'Left hand only', hands: ['left'] },
  { label: 'Right hand only', hands: ['right'] },
  { label: 'Both hands', hands: ['left', 'right'] },
]

function sameHands(a: readonly Hand[], b: readonly Hand[]): boolean {
  return a.length === b.length && a.every((hand) => b.includes(hand))
}

export function HandMuteControl({
  activeHands,
  onChange,
  disabled = false,
}: HandMuteControlProps) {
  return (
    // `.seg-control` (primitives.css): a bordered radiogroup is exactly what
    // this already was (roadmap UI-10) — the primitive's selection styling
    // reads off `[aria-checked="true"]`, which every option below already sets.
    <div className="hand-mute-control seg-control" role="radiogroup" aria-label="Hands">
      {OPTIONS.map((option) => {
        const selected = sameHands(activeHands, option.hands)
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.hands)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
