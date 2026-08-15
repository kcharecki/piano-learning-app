/**
 * The input-status chip (roadmap UI-04b, 2026-08-12 UI audit) — one home for
 * "can this browser see a MIDI keyboard", replacing the old dismissible
 * banner this file used to render. Before this, "No MIDI keyboard
 * connected" plus a "Pair Bluetooth MIDI" button rendered as IN-FLOW content
 * at the top of seven different screens (Practice, Sight reading,
 * Flashcards, Ear training, Rhythm, Technique, Theory), pushing the actual
 * task below them every time. This mounts once, in `Shell.tsx`'s
 * `.topbar-actions`, and tucks the detail behind a popover that opens on
 * demand instead of occupying permanent screen space on every destination.
 *
 * Two distinct "no keyboard" cases stay reachable and separate (roadmap
 * 5.6/B.7), exactly as the old banner + `MidiDeviceStatus` pairing kept them:
 *  - **Web MIDI does not exist in this browser at all** (every iOS/iPadOS
 *    browser) — a synchronous feature-detection fact (`isWebMidiSupported`),
 *    true the instant this component mounts, independent of whether a
 *    connection attempt ever resolves.
 *  - **Web MIDI exists but nothing is connected yet** (permission still
 *    pending, or granted with zero devices plugged in — the commonest
 *    no-hardware case, see `PracticeScreen.tsx`'s identical note) — this is
 *    `MidiDeviceStatus`'s own runtime state, rendered unchanged inside the
 *    popover (its `hideUsbStatus` prop only suppresses its USB line for the
 *    FIRST case above, where this component's own message already said the
 *    same thing in different words — see that prop's own doc).
 *
 * This component owns its own live `useMidiConnection()` connection so the
 * chip stays accurate on every screen, not only the ones that happen to run
 * a MIDI-consuming hook themselves (Metronome, Lessons, Settings, Progress
 * never call `useMidiConnection` today) — a second, independent connection
 * from whatever the active screen's own hook holds, which is harmless for
 * Web MIDI (the browser hands back the same cached `MIDIAccess`, not a new
 * physical connection) and mirrors the pre-existing pattern where every one
 * of the eight screens `MidiDeviceStatus` used to render already ran its own
 * independent connection.
 */
import { isWebMidiSupported } from '@adapters/midi/index.ts'
import { Icon } from '@app/ui/Icon.tsx'
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import { useMidiConnection, type ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { MidiInput } from '@core/ports/index.ts'
import { useEffect, useRef, useState } from 'react'

export type InputCapabilityBannerProps = {
  /** Test seam — defaults to real feature detection. */
  readonly supported?: boolean
  /** Injection seams for tests; each defaults to the real browser adapter — mirrors every screen's own `useMidiConnection` wiring. */
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
}

const POPOVER_ID = 'input-status-popover'

export function InputCapabilityBanner({
  supported = isWebMidiSupported(),
  midiInput,
  connectMidi,
}: InputCapabilityBannerProps) {
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const midi = useMidiConnection(
    midiInput !== undefined ? { midiInput } : connectMidi !== undefined ? { connect: connectMidi } : {},
  )
  const selectedDevice = midi.devices.find((device) => device.id === midi.selectedDeviceId)
  const connected = midi.input !== undefined && selectedDevice !== undefined

  function close(): void {
    setOpen(false)
    chipRef.current?.focus()
  }

  // Escape closes and returns focus to the chip — the same contract as the
  // Reference panel and the nav drawer (Shell.tsx).
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // A click anywhere outside the chip or the popover closes it — no focus
  // return here (unlike Escape): the learner clicked somewhere else on
  // purpose, so following that click is the expected outcome, not fighting it.
  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(e: MouseEvent): void {
      const target = e.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target) === true) return
      if (chipRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div className="input-status">
      <button
        type="button"
        ref={chipRef}
        className="btn-ghost input-status-chip"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={POPOVER_ID}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="midi-plug" />
        {connected ? 'MIDI connected' : 'No MIDI — using on-screen keys'}
      </button>
      {open && (
        <>
          {/* Light-dismiss layer (2026-08 UI audit BLOCKER): the popover is a
              floating `.card` — opaque background, padding, gaps between its
              children — parked directly over page content on 5 of 10 screens
              (Today's "Set up my practice" among them). Padding/gaps inside
              the popover are NOT interactive, but the outside-click handler
              below still treated any click landing on them as "inside" and
              did nothing: the click neither closed the popover nor reached
              the control it happened to be sitting over, so that control was
              unreachable. This full-viewport layer sits BENEATH the popover
              (z-index below it — feature-bluetooth-midi.css) and the popover
              itself now lets pointer events pass through everywhere except
              its real controls (same file), so a click on the popover's dead
              space now falls through to this layer and closes it — reliably,
              on the first click, everywhere the popover can float. Dismiss
              only, no pass-through to whatever sat underneath: same contract
              as the outside-click handler already had (no focus return
              either) — a second click, now that the popover is gone, reaches
              the control normally. */}
          <div className="input-status-scrim" aria-hidden="true" onPointerDown={() => setOpen(false)} />
          <div id={POPOVER_ID} ref={popoverRef} className="card input-status-popover">
            {!supported && (
              <p role="status">
                This browser can&apos;t connect a MIDI keyboard — you can still listen, read and
                play with the on-screen keys.
              </p>
            )}
            <MidiDeviceStatus
              connected={midi.input !== undefined}
              devices={midi.devices}
              selectedDeviceId={midi.selectedDeviceId}
              connectionError={midi.connectionError}
              hideUsbStatus={!supported}
            />
            <p className="input-status-mic-hint">No keyboard? Try the microphone on Practice.</p>
          </div>
        </>
      )}
    </div>
  )
}
