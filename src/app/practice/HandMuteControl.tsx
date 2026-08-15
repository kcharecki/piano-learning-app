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

/**
 * `short` is what renders; `label` (the pre-existing full wording) becomes
 * `aria-label` (roadmap UI-27, toolbar-width fix, 2026-08-15) — `aria-label`
 * wins the accessible-name computation over a button's own text content, so
 * every existing `getByRole('radio', { name: 'Left hand only' })` query still
 * matches, and the group's own `aria-label="Hands"` already carries the
 * "hand" context these three no longer need to repeat. This control sits in
 * the sticky toolbar (roadmap UI-27) beside transport, loop range, tempo and
 * mic; "Left hand only" / "Right hand only" at full width was the single
 * widest thing in the row.
 */
const OPTIONS: readonly { readonly label: string; readonly short: string; readonly hands: readonly Hand[] }[] = [
  { label: 'Left hand only', short: 'Left', hands: ['left'] },
  { label: 'Right hand only', short: 'Right', hands: ['right'] },
  { label: 'Both hands', short: 'Both', hands: ['left', 'right'] },
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
            aria-label={option.label}
            disabled={disabled}
            onClick={() => onChange(option.hands)}
          >
            {option.short}
          </button>
        )
      })}
    </div>
  )
}
