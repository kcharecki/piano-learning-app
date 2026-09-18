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
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMidiConnection, type ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { createKitMapEngine } from '@core/drums/kitmap/engine.ts'
import type { KitMap } from '@core/drums/kitmap/kitMap.ts'
import { GM_KIT_MAP } from '@core/drums/kitmap/presets.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import { isMappedDrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { MidiInput } from '@core/ports/index.ts'

export type DrumMidiInputOptions = {
  /** Called once per real stroke on a mapped pad. NOT called for chokes (articulation 'choke') or unmapped notes. */
  readonly onHit: (pad: MappedDrumPad, hit: RawDrumHit) => void
  /** Test seam, passed straight through to `useMidiConnection`. */
  readonly midiInput?: MidiInput
  /** Test seam, passed straight through to `useMidiConnection`. */
  readonly connect?: ConnectMidi
  /** Defaults to `GM_KIT_MAP`. A new map builds a new engine. */
  readonly kitMap?: KitMap
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
  /** Learner copy for one status line — see `ekitStatusText`. */
  readonly statusText: string
}

/** Pure; exported so the screen test and the hook test can pin the copy. */
export function ekitStatusText(state: Omit<DrumMidiInputState, 'statusText'>, kitMapName: string): string {
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
  const { onHit, midiInput, connect, kitMap = GM_KIT_MAP } = options

  const { input, devices, selectedDeviceId, connectionError } = useMidiConnection({
    ...(midiInput === undefined ? {} : { midiInput }),
    ...(connect === undefined ? {} : { connect }),
  })

  // One engine per kit map — it carries debounce/CC#4 state across events and
  // must not be rebuilt on every render or every incoming event.
  const engine = useMemo(() => createKitMapEngine({ kitMap }), [kitMap])

  const [lastUnmappedNote, setLastUnmappedNote] = useState<number | undefined>(undefined)

  const onHitRef = useRef(onHit)
  useEffect(() => {
    onHitRef.current = onHit
  }, [onHit])

  useEffect(() => {
    if (input === undefined) return undefined
    return input.onEvent((event) => {
      for (const output of engine.handle(event)) {
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
  }, [input, engine])

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)
  const connected = input !== undefined && selectedDevice !== undefined

  const state: Omit<DrumMidiInputState, 'statusText'> = {
    connected,
    deviceName: selectedDevice?.name,
    deviceId: connected ? selectedDevice?.id : undefined,
    connectionError,
    lastUnmappedNote,
  }

  return { ...state, statusText: ekitStatusText(state, kitMap.name) }
}
