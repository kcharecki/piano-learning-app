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

  // A pointerdown anywhere outside the chip or the popover closes it — no
  // focus return here (unlike Escape): the learner is pressing on something
  // else on purpose (roadmap UI-33), so the popover must get out of the way
  // of that press rather than fight it. This is a non-modal, undimmed,
  // informational popover, not a menu of pending commands, so it follows the
  // same light-dismiss contract as `popover="auto"`: dismiss on pointerdown
  // WITHOUT calling preventDefault/stopPropagation, so the same press's
  // subsequent mouseup/click still lands on and activates whatever control
  // sits underneath — one press both closes this and operates that control.
  // Listening on `pointerdown` rather than `click` is what makes that
  // ordering possible (`click` fires after the underlying control would
  // already need to have reacted); `pointerdown` also unifies mouse, touch
  // and pen in one handler, which `mousedown` does not reliably do on touch.
  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(e: PointerEvent): void {
      const target = e.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target) === true) return
      if (chipRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
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
        // No full-viewport scrim here (roadmap UI-33 — one used to sit
        // beneath this popover solely to catch clicks on its own dead space
        // and close it). The popover's own dead space (padding, the `flex`
        // gaps between its children) is already `pointer-events: none` in
        // feature-bluetooth-midi.css, with only its real controls opted back
        // in — that CSS predates this fix and needed no change — so a press
        // there falls straight through to whatever the popover is floating
        // over, and the document-level pointerdown listener above (which
        // sees every press, not just ones a scrim would have intercepted)
        // closes the popover in response. A full-viewport interactive layer
        // would consume the press instead of letting it reach the control
        // underneath, which is exactly the behaviour roadmap UI-33 removed.
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
      )}
    </div>
  )
}
