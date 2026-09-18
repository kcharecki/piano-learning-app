/**
 * `useDrumMidiInput` (roadmap DR-02, app slice): joins the piano side's Web
 * MIDI connection (`useMidiConnection`) to the drum side's pure kit-map core
 * (`@core/drums/kitmap`), so a learner with a real e-kit plugged in plays the
 * same trainers a keyboard/pad learner does.
 *
 * One `KitMapEngine` per `kitMap` (memoised — it is stateful: CC#4 hi-hat
 * position and per-pad debounce live inside it and must survive across
 * renders, not just across events within one render). `onHit` is read
 * through a ref so a new callback identity on every render of the caller
 * never tears down and rebuilds the MIDI subscription.
 *
 * This hook renders nothing. `GrooveTrainerScreen` and
 * `CoordinationTrainerScreen` each call it with their run's `hit` as `onHit`
 * and render `statusText` as one `role="status"` line labelled "E-kit".
 *
 * Which kit map applies (roadmap DR-02): an explicit `kitMap` option always
 * wins (tests and any future caller that knows its own map rely on this).
 * Otherwise the map comes from `useDrumsKitMapStore`'s `presetName` and
 * `learned`, resolved through `kitMapFor` — this is how a learner's
 * Roland/Alesis/Yamaha pick, or their own MIDI-learned map, reaches every
 * trainer without each one having to read the store itself.
 *
 * `lastNoteOn` (roadmap DR-02's MIDI-learn wizard) mirrors every note-on the
 * connection delivers, mapped or not, with a `seq` that increments per event
 * so the wizard (which advances a step per stroke) can tell two hits of the
 * same note apart even though the payload itself would otherwise be
 * `Object.is`-equal from one render to the next.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMidiConnection, type ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { kitMapFor, useDrumsKitMapStore } from '@app/state/drumsKitMapStore.ts'
import { createKitMapEngine, type KitMapOutput } from '@core/drums/kitmap/engine.ts'
import type { KitMap } from '@core/drums/kitmap/kitMap.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import { isMappedDrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { MidiEvent, MidiInput } from '@core/ports/index.ts'
import { appendEntry, classify, type MonitorEntry } from './monitor.ts'

export type DrumMidiInputOptions = {
  /** Called once per real stroke on a mapped pad. NOT called for chokes (articulation 'choke') or unmapped notes. */
  readonly onHit: (pad: MappedDrumPad, hit: RawDrumHit) => void
  /** Test seam, passed straight through to `useMidiConnection`. */
  readonly midiInput?: MidiInput
  /** Test seam, passed straight through to `useMidiConnection`. */
  readonly connect?: ConnectMidi
  /**
   * Defaults to the learner's stored kit-map preset or learned map
   * (`useDrumsKitMapStore`/`kitMapFor`, itself `GM_KIT_MAP` until a preset
   * is chosen, a map is learned, or the stored name is unrecognised). An
   * explicit map here always wins over the store. A new map builds a new
   * engine.
   */
  readonly kitMap?: KitMap
  /**
   * Keeps a rolling `MonitorEntry[]` (roadmap DR-08's input monitor) built
   * from every raw event the connection delivers, including ones the engine
   * swallows. Default false: the graded trainers run this hook on every
   * stroke of a timed run and must not pay a per-event state update (extra
   * render) for a feature only the calibration screen shows.
   */
  readonly monitor?: boolean
}

export type DrumMidiInputState = {
  /** True when a MIDI input exists AND the selected device id names one of its listed devices. */
  readonly connected: boolean
  readonly deviceName: string | undefined
  /** The selected device's id when `connected`, else undefined. */
  readonly deviceId: string | undefined
  readonly connectionError: string | undefined
  /** The note number of the most recent note-on the kit map did not recognise; undefined until one arrives. Never cleared by a mapped hit. */
  readonly lastUnmappedNote: number | undefined
  /**
   * The most recent raw note-on, regardless of whether the active kit map
   * knows it — the MIDI-learn wizard (roadmap DR-02) captures pads the
   * current map already claims just as readily as ones it does not.
   * `seq` increments on every note-on so two hits of the same note are
   * distinguishable; undefined until the first note-on arrives.
   */
  readonly lastNoteOn: { readonly note: number; readonly velocity: number; readonly seq: number } | undefined
  /** Learner copy for one status line — see `ekitStatusText`. */
  readonly statusText: string
  /** Newest-first, capped at `MONITOR_CAPACITY`. Always `[]` when `monitor` is false. */
  readonly monitor: readonly MonitorEntry[]
}

/** Pure; exported so the screen test and the hook test can pin the copy. */
export function ekitStatusText(
  state: Omit<DrumMidiInputState, 'statusText' | 'monitor'>,
  kitMapName: string,
): string {
  if (state.connected) {
    const base = `E-kit: ${state.deviceName} · ${kitMapName} map`
    return state.lastUnmappedNote === undefined
      ? base
      : `${base} · a pad sent note ${state.lastUnmappedNote}, which is not in the map`
  }
  if (state.connectionError !== undefined) return `No e-kit: ${state.connectionError}`
  return 'No e-kit connected — the pads and keys below still work'
}

export function useDrumMidiInput(options: DrumMidiInputOptions): DrumMidiInputState {
  const { onHit, midiInput, connect, kitMap: explicitKitMap, monitor = false } = options

  // Always called (rules of hooks) even when an explicit `kitMap` wins below.
  const storedPresetName = useDrumsKitMapStore((state) => state.presetName)
  const storedLearned = useDrumsKitMapStore((state) => state.learned)
  const kitMap = explicitKitMap ?? kitMapFor(storedPresetName, storedLearned)

  const { input, devices, selectedDeviceId, connectionError } = useMidiConnection({
    ...(midiInput === undefined ? {} : { midiInput }),
    ...(connect === undefined ? {} : { connect }),
  })

  // One engine per kit map — it carries debounce/CC#4 state across events and
  // must not be rebuilt on every render or every incoming event.
  const engine = useMemo(() => createKitMapEngine({ kitMap }), [kitMap])

  const [lastUnmappedNote, setLastUnmappedNote] = useState<number | undefined>(undefined)

  // The wizard's raw feed (roadmap DR-02): a plain counter ref for `seq`,
  // same reasoning as `seqRef` below — it must keep counting across
  // renders and is cheap enough to always run, `monitor` or not.
  const noteOnSeqRef = useRef(0)
  const [lastNoteOn, setLastNoteOn] = useState<DrumMidiInputState['lastNoteOn']>(undefined)

  const onHitRef = useRef(onHit)
  useEffect(() => {
    onHitRef.current = onHit
  }, [onHit])

  // Monitor entries (roadmap DR-08): a plain counter ref, not state, so
  // building it costs nothing when `monitor` is off — no state read, no
  // re-render — and `seq` stays stable across the monitor being toggled off
  // and back on mid-session. `atMs` is the event's own `time` field (the
  // adapter's MIDI timestamp), never a clock read here.
  const seqRef = useRef(0)
  const [monitorEntries, setMonitorEntries] = useState<readonly MonitorEntry[]>([])

  useEffect(() => {
    if (input === undefined) return undefined
    return input.onEvent((event: MidiEvent) => {
      if (event.type === 'noteOn') {
        const seq = noteOnSeqRef.current
        noteOnSeqRef.current += 1
        setLastNoteOn({ note: event.note, velocity: event.velocity, seq })
      }

      const outputs: readonly KitMapOutput[] = engine.handle(event)

      if (monitor) {
        const seq = seqRef.current
        seqRef.current += 1
        const nextEntry = classify(seq, event.time, event, outputs)
        setMonitorEntries((prev) => appendEntry(prev, nextEntry))
      }

      for (const output of outputs) {
        if (output.kind === 'unmapped') {
          setLastUnmappedNote(output.event.note)
          continue
        }
        const { hit } = output
        if (hit.articulations.includes('choke')) continue
        if (!isMappedDrumPad(hit.pad)) continue
        onHitRef.current(hit.pad, hit)
      }
    })
  }, [input, engine, monitor])

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)
  const connected = input !== undefined && selectedDevice !== undefined

  const state: Omit<DrumMidiInputState, 'statusText' | 'monitor'> = {
    connected,
    deviceName: selectedDevice?.name,
    deviceId: connected ? selectedDevice?.id : undefined,
    connectionError,
    lastUnmappedNote,
    lastNoteOn,
  }

  return { ...state, statusText: ekitStatusText(state, kitMap.name), monitor: monitor ? monitorEntries : [] }
}
