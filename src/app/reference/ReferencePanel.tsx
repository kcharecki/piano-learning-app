/**
 * The shell-level chord/scale reference panel (roadmap 3.17, REQ-3.5.4): the
 * mechanism resolved in `docs/parallel-round-10.md` Q2 — a non-modal overlay
 * side panel, not the Theory destination's own full-screen route. Before
 * this, looking up a chord meant leaving Practice entirely (losing the
 * loaded score's screen instance would be even worse — see below), so a
 * learner mid-piece could not glance at a fingering without abandoning the
 * transport.
 *
 * ## Why this shape (see parallel-round-10.md Q2 for the full comparison)
 *
 * - **Not a modal**: no `aria-modal`, no focus trap. Tab must be able to
 *   leave this panel and reach the routed screen's own controls (e.g. the
 *   transport's pause button) while the panel stays open — REQ-3.5.4 is
 *   "available at all times", not "available instead of your work".
 * - **Mount nothing until first open, then hide rather than unmount**: the
 *   `hasOpenedOnce` flag below is the whole mechanism. Once true, this
 *   component always renders its content (so the learner's root/scale
 *   selection and this panel's own OSMD engraving — via `ChordScaleReference`
 *   -> `ScaleStaff` — survive a close), and `open` only ever toggles the
 *   native `hidden` attribute, never a mount/unmount.
 * - **`position: fixed`** (in `feature-reference-panel.css`), so this panel
 *   never becomes a layout column: the routed screen's box never changes
 *   size, so a Practice OSMD engraving never re-renders because the panel
 *   opened or closed.
 * - **State lives here, not in the router**: `root`/`scaleType` are this
 *   component's own `useState`, and `open`/`onClose` are plain props from
 *   `Shell.tsx` — never `Route` params. A route-tracked "panel open" flag
 *   would make Back close the panel mid-practice, which is chrome behaving
 *   like navigation.
 *
 * `ChordScaleReference` is imported, never edited — this file only supplies
 * the root/scaleType state it is a controlled component over, exactly as
 * `TheoryScreen` already does for its own copy of that same state.
 */
import { useEffect, useRef, useState } from 'react'
import type { AudioOutput } from '@core/ports/audio.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import type { SpelledPitch } from '@core/theory/pitch.ts'
import type { ScaleType } from '@core/theory/scales.ts'
import { ChordScaleReference } from '@app/theory/ChordScaleReference.tsx'
import { Icon } from '@app/ui/Icon.tsx'

const DEFAULT_KEY = keyFromFifths(0, 'major')
const DEFAULT_ROOT: SpelledPitch = DEFAULT_KEY.tonic
const DEFAULT_SCALE_TYPE: ScaleType = 'major'

export type ReferencePanelProps = {
  readonly open: boolean
  /** Closes the panel — Shell also returns focus to its toggle button here (Escape and the scrim both call this). */
  readonly onClose: () => void
  /** Injection seam for tests; forwarded to `ChordScaleReference` unchanged. */
  readonly audioOutput?: AudioOutput
}

export function ReferencePanel({ open, onClose, audioOutput }: ReferencePanelProps) {
  // Mount nothing until the first open (module doc) — seeded from `open` so
  // a panel that starts already open (not how Shell drives it today, but a
  // legitimate future caller) does not need a first toggle to appear.
  const [hasOpenedOnce, setHasOpenedOnce] = useState(open)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Owned here, not by Shell (module doc): a controlled pair for
  // ChordScaleReference, exactly like TheoryScreen's own copy.
  const [root, setRoot] = useState<SpelledPitch>(DEFAULT_ROOT)
  const [scaleType, setScaleType] = useState<ScaleType>(DEFAULT_SCALE_TYPE)

  useEffect(() => {
    if (open) setHasOpenedOnce(true)
  }, [open])

  // Focus moves to the close button on open (spec) — no trap, so Tab from
  // here continues wherever DOM order takes it next, out of the panel.
  // Depends on `hasOpenedOnce` too, not just `open`: on the FIRST open,
  // `hasOpenedOnce` is still false during this same effect pass (the render
  // that decided to mount happens one tick later, after the effect above's
  // `setHasOpenedOnce(true)` lands) — this component renders `null` on that
  // pass, so `closeButtonRef.current` is still null and a `[open]`-only
  // effect's `.focus()` would silently no-op. Once `hasOpenedOnce` flips
  // true and the close button actually exists, this effect's dependency
  // array changes and it re-runs against the real DOM node.
  useEffect(() => {
    if (open && hasOpenedOnce) closeButtonRef.current?.focus()
  }, [open, hasOpenedOnce])

  // Escape closes — the scrim (≤1024px, feature-reference-panel.css) and the
  // close button both call `onClose` directly via their own handlers.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!hasOpenedOnce) return null

  return (
    <>
      {/* Only ever painted at <=1024px (feature-reference-panel.css) — at
          wider viewports this panel is non-blocking chrome and no scrim is
          shown at all, per the resolved mechanism. */}
      <div
        className="reference-panel-scrim"
        data-testid="reference-panel-scrim"
        hidden={!open}
        onClick={onClose}
      />
      <aside
        id="reference-panel"
        role="complementary"
        aria-label="Chord and scale reference"
        hidden={!open}
      >
        <div className="reference-panel-header page-header">
          <h2>Reference</h2>
          <button
            type="button"
            ref={closeButtonRef}
            className="btn-icon"
            onClick={onClose}
            aria-label="Close reference"
          >
            <Icon name="x" />
          </button>
        </div>
        <ChordScaleReference
          root={root}
          scaleType={scaleType}
          onRootChange={setRoot}
          onScaleTypeChange={setScaleType}
          {...(audioOutput === undefined ? {} : { audioOutput })}
        />
      </aside>
    </>
  )
}
