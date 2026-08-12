/**
 * Live MIDI device indicator (roadmap 1.18, REQ-4.1): shows the connected
 * keyboard, or degrades gracefully to "no MIDI keyboard connected" — the app
 * has to stay usable for listening and reading with no hardware at all.
 *
 * Also the Bluetooth LE MIDI pairing control (roadmap B.2, REQ-3.3.1). This
 * component is rendered, unchanged, by all eight note-answered screens
 * (Practice, Technique, Rhythm x2, Flashcards, Ear training, Sight reading,
 * TheoryDrillPanel), so it is the one place a BLE "Pair" control reaches every
 * screen at once WITHOUT a new required prop anywhere: it calls
 * `useBluetoothMidi` itself rather than taking BLE state as props. The actual
 * note events reach the matcher through a different path — see
 * `useBluetoothMidi.ts`'s module comment on the registry `useMidiConnection.ts`
 * fans into its own event stream — this component only shows pairing status.
 */
import { useBluetoothMidi } from './useBluetoothMidi.ts'
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
  const bluetooth = useBluetoothMidi()

  return (
    <div className="midi-device-status">
      {!connected || selected === undefined ? (
        <p className="midi-status midi-status-none" role="status">
          No MIDI keyboard connected — you can still listen and read along.
          {connectionError !== undefined && <span> ({connectionError})</span>}
        </p>
      ) : (
        <p className="midi-status midi-status-connected" role="status" data-state="connected">
          MIDI keyboard connected: {selected.name}
        </p>
      )}
      <div className="bluetooth-midi-control">
        {!bluetooth.supported ? (
          <p className="bluetooth-midi-status" role="status" data-state="unsupported">
            Bluetooth MIDI is not available in this browser.
          </p>
        ) : bluetooth.device === undefined ? (
          <button type="button" className="btn" onClick={bluetooth.pair} disabled={bluetooth.pairing}>
            {bluetooth.pairing ? 'Pairing…' : 'Pair Bluetooth MIDI'}
          </button>
        ) : (
          <p className="bluetooth-midi-status" role="status" data-state="connected">
            Bluetooth MIDI connected: {bluetooth.device.name}
            <button type="button" className="btn-ghost" onClick={bluetooth.disconnect}>
              Disconnect
            </button>
          </p>
        )}
        {bluetooth.error !== undefined && (
          <p className="bluetooth-midi-status" role="status" data-state="error">
            Bluetooth MIDI unavailable ({bluetooth.error})
          </p>
        )}
      </div>
    </div>
  )
}
