/**
 * The latency calibration screen (roadmap DR-08): a steady click at 80 bpm,
 * the learner plays along on any pad for 16 hits, and the median offset of
 * their rig — read off `useCalibration` — is what `useGrooveRun`'s own
 * `inputOffsetMs` subtracts from every graded hit elsewhere in the app, once
 * saved here.
 *
 * Structure mirrors `GrooveTrainerScreen.tsx`: an e-kit status line from
 * `useDrumMidiInput`, the same three pads and keyboard bindings the groove
 * trainer uses (`GrooveControls.tsx` / `groovePadHooks.ts`), Start/Stop, and
 * a result panel — but there is no staff and no per-pad grading here, since
 * every pad counts toward one number for the whole rig.
 *
 * The offset is stored per INPUT, not per learner: an e-kit and the
 * on-screen pads/keyboard read very differently (a real drum trigger versus
 * a browser keydown), so `LOCAL_INPUT_ID` and a MIDI device's own id each get
 * their own record in `drumsLatencyStore`.
 *
 * Also the one place a learner picks their kit-map preset (roadmap DR-02):
 * the "Kit map" select writes `drumsKitMapStore`, which `useDrumMidiInput`
 * reads by default in every trainer — so a Roland/Alesis/Yamaha kit's notes
 * resolve correctly everywhere, not just here.
 */
import { useDrumMidiInput } from '@app/drums/input/useDrumMidiInput.ts'
import { Pad } from '@app/drums/groove/GrooveControls.tsx'
import { useFlash, useKeyboardPads } from '@app/drums/groove/groovePadHooks.ts'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsKitMapStore } from '@app/state/drumsKitMapStore.ts'
import { LOCAL_INPUT_ID, useDrumsLatencyStore } from '@app/state/drumsLatencyStore.ts'
import { KIT_MAP_PRESETS } from '@core/drums/kitmap/presets.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { Clock, DrumAudioOutput, MidiInput } from '@core/ports/index.ts'
import {
  calibrationStateText,
  spreadWarningText,
  storedOffsetText,
  summaryText,
  wirelessNoticeText,
} from './calibrationText.ts'
import { InputMonitor } from './InputMonitor.tsx'
import { useCalibration } from './useCalibration.ts'

/** The three pads the groove trainer keys map to — enough to play along with any hand. */
const CALIBRATION_PADS: readonly MappedDrumPad[] = ['kick', 'snare', 'hhClosed']

export type CalibrationScreenProps = {
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly frameDriver?: FrameDriver
  /** A ready-made e-kit MIDI input (roadmap DR-02); defaults to Web MIDI through `useMidiConnection`. */
  readonly midiInput?: MidiInput
  /** Test seam, passed straight through to `useDrumMidiInput`/`useMidiConnection`. */
  readonly connect?: ConnectMidi
}

export function CalibrationScreen(props: CalibrationScreenProps) {
  const cal = useCalibration({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audio === undefined ? {} : { audio: props.audio }),
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
  })

  const ekit = useDrumMidiInput({
    onHit: (pad) => cal.hit(pad),
    monitor: true,
    ...(props.midiInput === undefined ? {} : { midiInput: props.midiInput }),
    ...(props.connect === undefined ? {} : { connect: props.connect }),
  })

  const offsets = useDrumsLatencyStore((state) => state.offsets)
  const setOffset = useDrumsLatencyStore((state) => state.setOffset)
  const clearOffset = useDrumsLatencyStore((state) => state.clearOffset)

  const kitMapPresetName = useDrumsKitMapStore((state) => state.presetName)
  const setKitMapPreset = useDrumsKitMapStore((state) => state.setPreset)

  const inputId = ekit.deviceId ?? LOCAL_INPUT_ID
  const inputLabel = ekit.deviceName ?? 'Pads and keys'
  const storedRecord = offsets[inputId]

  // Deliberately excludes 'done': a finished run has nothing left to stop,
  // and the learner must be able to press Start again to run once more
  // (`useCalibration.start()` resets `summary`/`deviationsMs` itself,
  // regardless of which phase it is called from).
  const running = cal.phase === 'count-in' || cal.phase === 'collecting'
  const lit = useFlash(cal.flash)
  useKeyboardPads(CALIBRATION_PADS, cal.hit, running)

  const summary = cal.summary
  const warning = summary === undefined ? undefined : spreadWarningText(summary, ekit.deviceName)
  const wirelessNotice = wirelessNoticeText(ekit.deviceName)

  return (
    <div className="page page--focus calibration-screen">
      <div className="page-header">
        <h1>Latency</h1>
        <p className="page-header-subtitle">
          Play along with a click; the median offset of your rig is subtracted from every graded
          hit.
        </p>
      </div>

      <div className="card groove-stage calibration-stage">
        <p role="status" aria-label="E-kit" className="groove-ekit">
          {ekit.statusText}
        </p>

        <div className="card field calibration-kit-map-field">
          <label htmlFor="drums-kit-map-select">Kit map</label>
          <select
            id="drums-kit-map-select"
            aria-label="Kit map"
            value={kitMapPresetName}
            onChange={(event) => setKitMapPreset(event.target.value)}
          >
            {KIT_MAP_PRESETS.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
          <p>
            Which notes your kit sends for each pad. Change it if pads show as unmapped in the
            monitor below.
          </p>
        </div>

        {wirelessNotice !== undefined && (
          <p className="calibration-warning" role="note" aria-label="Wireless notice">
            {wirelessNotice}
          </p>
        )}
        <p role="status" aria-label="Stored offset" className="calibration-stored-offset">
          {storedOffsetText(inputLabel, storedRecord)}
        </p>

        <div className="groove-transport">
          <button
            type="button"
            className="btn-primary"
            aria-label="Start"
            disabled={running}
            onClick={cal.start}
          >
            Start
          </button>
          <button type="button" aria-label="Stop" disabled={!running} onClick={cal.stop}>
            Stop
          </button>
        </div>

        <p role="status" aria-label="Calibration state" className="calibration-state">
          {calibrationStateText(cal.phase, cal.beat, cal.hits)}
        </p>

        {summary !== undefined && (
          <>
            <p role="status" aria-label="Result" className="calibration-result">
              {summaryText(summary)}
            </p>
            {warning !== undefined && <p className="calibration-warning">{warning}</p>}
            <div className="groove-transport">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setOffset(inputId, { ...summary, at: Date.now() })}
              >
                Save offset
              </button>
              {storedRecord !== undefined && (
                <button type="button" onClick={() => clearOffset(inputId)}>
                  Clear offset
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="groove-pads">
        {CALIBRATION_PADS.map((pad) => (
          <Pad key={pad} pad={pad} lit={lit === pad} onHit={cal.hit} />
        ))}
      </div>

      <InputMonitor entries={ekit.monitor} />
    </div>
  )
}
