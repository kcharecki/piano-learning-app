/**
 * States what this browser cannot do (roadmap 5.6) instead of degrading
 * silently. Every screen that plays a note routes through Web MIDI
 * (`useMidiConnection`); on a browser with none — every iOS/iPadOS browser,
 * see B.7 — that failure previously surfaced only as a small per-screen
 * "no MIDI keyboard connected" line indistinguishable from "just not plugged
 * in yet". This names the platform limit once, dismissibly, for the session.
 */
import { isWebMidiSupported } from '@adapters/midi/index.ts'
import { useState } from 'react'

export type InputCapabilityBannerProps = {
  /** Test seam — defaults to real feature detection. */
  readonly supported?: boolean
}

export function InputCapabilityBanner({
  supported = isWebMidiSupported(),
}: InputCapabilityBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (supported || dismissed) return null

  return (
    <div className="input-capability-banner" role="status">
      <p>
        This browser can&apos;t see a MIDI keyboard (no Web MIDI) — note matching, timing
        feedback and keyboard-answered drills won&apos;t work, but you can still listen, read
        and play with the on-screen keyboard.
      </p>
      <button
        type="button"
        className="btn-icon"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  )
}
