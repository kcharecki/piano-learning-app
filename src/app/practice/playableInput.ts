/**
 * The practice screen's input seam (roadmap 5.4, REQ-3.3.7).
 *
 * ## The defect this closes
 *
 * `PracticeScreen` used to hand `useRecorder` the raw `MidiInput | undefined`
 * from `useMidiConnection`, and `useRecorder` builds no fan-out at all when
 * that is `undefined`. So on Safari, Firefox or an iPad — no Web MIDI, see
 * `docs/WORKTREES.md`'s sibling note in roadmap B.7 — `recorder.input` was
 * `undefined`, and with it note matching, feedback colouring, wait mode,
 * assessment, timing feedback, recording and the tempo ramp were ALL inert on
 * the one screen where playing is the point. The other note-answered screens
 * (Flashcards, Theory, Dictation) have rendered `OnScreenKeyboard` all along.
 *
 * ## The shape
 *
 * A `PlayableMidiInput` is a `MidiInput` that is always present. It forwards
 * every event from the hardware device when there is one, and also emits
 * events of its own when `press`/`release` are called from the on-screen
 * keyboard. Everything downstream — `useRecorder`'s fan-out, `useNoteFeedback`,
 * `usePracticeEngine`, `useAssessment` — therefore cannot tell a clicked note
 * from a played one, which is the entire point: an on-screen note is graded by
 * the real matcher, advances wait mode, and lands in a recording, through the
 * exact code path a MIDI keyboard drives. The same argument `useRecorder`
 * makes for replay ("rather than needing a second, parallel judging path that
 * could disagree with the live one") applies here.
 *
 * Device metadata (`listDevices`, `onDevicesChanged`, `selectDevice`,
 * `selectedDeviceId`) is proxied straight through to the hardware input, and
 * reads as "no devices" when there is none. This object deliberately does NOT
 * invent a device entry for itself: `MidiDeviceStatus` and `RecordPanel` ask
 * about real hardware, and answering "connected" because a screen has a
 * clickable keyboard on it is exactly the silent-degradation lie roadmap 5.6
 * exists to fix.
 */
import type {
  Clock,
  MidiDevice,
  MidiEvent,
  MidiInput,
  Unsubscribe,
} from '@core/ports/index.ts'
import { type Midi } from '@core/shared/units.ts'

/**
 * Velocity for an on-screen note. A mouse click and a tap carry no force, and
 * `MidiNoteOn.velocity` is documented as 1–127 with 0 meaning note-off, so
 * some non-zero value must be invented. A mezzo-forte-ish 80 is the least
 * misleading: loud enough that nothing reads it as a ghost note, and not 127,
 * which would flatter any future dynamics work into thinking the learner
 * played fortissimo.
 */
export const ON_SCREEN_VELOCITY = 80

export interface PlayableMidiInput extends MidiInput {
  /** Sound a note now, as if a key went down. Ignored if already down. */
  press(note: Midi): void
  /** Release a note now. Ignored if it is not currently down. */
  release(note: Midi): void
  /** Release every held on-screen note — used when the keyboard is hidden. */
  releaseAll(): void
  /** Drop the subscription to the hardware input. Call once, on unmount. */
  dispose(): void
}

class PlayableInput implements PlayableMidiInput {
  private readonly device: MidiInput | undefined
  private readonly clock: Clock
  private readonly handlers = new Set<(event: MidiEvent) => void>()
  private readonly unsubscribeDevice: Unsubscribe | undefined
  /** Notes currently down BY THIS OBJECT — hardware notes are not tracked. */
  private readonly down = new Set<number>()

  constructor(device: MidiInput | undefined, clock: Clock) {
    this.device = device
    this.clock = clock
    this.unsubscribeDevice = device?.onEvent((event) => this.emit(event))
  }

  listDevices(): readonly MidiDevice[] {
    return this.device?.listDevices() ?? []
  }

  onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    return this.device?.onDevicesChanged(handler) ?? ((): void => {})
  }

  selectDevice(deviceId: string | null): void {
    this.device?.selectDevice(deviceId)
  }

  get selectedDeviceId(): string | null {
    return this.device?.selectedDeviceId ?? null
  }

  onEvent(handler: (event: MidiEvent) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  press(note: Midi): void {
    // Guarding here as well as in `OnScreenKeyboard` because this object is
    // also the seam a computer-keyboard mapping will press through (roadmap
    // 5.5), and a held QWERTY key autorepeats. A doubled note-on with no
    // note-off between reads to the matcher as an extra note.
    if (this.down.has(note)) return
    this.down.add(note)
    this.emit({ type: 'noteOn', note, velocity: ON_SCREEN_VELOCITY, time: this.clock.now() })
  }

  release(note: Midi): void {
    if (!this.down.delete(note)) return
    this.emit({ type: 'noteOff', note, time: this.clock.now() })
  }

  releaseAll(): void {
    for (const note of [...this.down]) this.release(note as Midi)
  }

  private emit(event: MidiEvent): void {
    for (const handler of this.handlers) handler(event)
  }

  dispose(): void {
    // Release before dropping subscribers, so a note held when the screen goes
    // away still gets its note-off through the matcher rather than being left
    // credited as held forever by wait mode.
    this.releaseAll()
    this.unsubscribeDevice?.()
    this.handlers.clear()
  }
}

/**
 * Build the practice screen's input. `device` is the hardware `MidiInput` when
 * one connected, `undefined` when Web MIDI is unavailable or no keyboard is
 * plugged in — the returned input works either way.
 */
export function createPlayableInput(
  device: MidiInput | undefined,
  clock: Clock,
): PlayableMidiInput {
  return new PlayableInput(device, clock)
}
