/**
 * Live MIDI device indicator (roadmap 1.18, REQ-4.1): shows the connected
 * keyboard, or degrades gracefully to "no MIDI keyboard connected" — the app
 * has to stay usable for listening and reading with no hardware at all.
 */
import type { MidiDevice } from '@core/ports/index.ts'

export type MidiDeviceStatusProps = {
  readonly connected: boolean
  readonly devices: readonly MidiDevice[]
  readonly selectedDeviceId: string | null
  readonly connectionError: string | undefined
}

export function MidiDeviceStatus({
  connected,
  devices,
  selectedDeviceId,
  connectionError,
}: MidiDeviceStatusProps) {
  const selected = devices.find((device) => device.id === selectedDeviceId)

  if (!connected || selected === undefined) {
    return (
      <p className="midi-status midi-status-none" role="status">
        No MIDI keyboard connected — you can still listen and read along.
        {connectionError !== undefined && <span> ({connectionError})</span>}
      </p>
    )
  }

  return (
    <p className="midi-status midi-status-connected" role="status">
      MIDI keyboard connected: {selected.name}
    </p>
  )
}
