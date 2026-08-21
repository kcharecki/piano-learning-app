/**
 * Standalone metronome (roadmap 2.28, REQ-3.9.1): absolute BPM, time
 * signature, subdivision and accent pattern, runnable with NO score loaded —
 * that is the whole point of this hook existing separately from
 * `usePracticeEngine`'s score-following metronome dispatch.
 *
 * Scheduling is not reinvented here: clicks come from `clicksInRange`
 * (`@core/timing/metronome.ts`), the exact function `usePracticeEngine`'s
 * `dispatchMetronome` uses, and the per-frame pump is the same
 * `useTransportLoop` every other feature in this app shares — never
 * `setInterval`, which drifts, and never a second scheduler.
 *
 * The tick position is anchored to a wall-clock instant exactly like
 * `Transport` does: at any moment, `tick = msToTick(tempoMap, clock.now() -
 * originMs)`. A bpm change while running reanchors *synchronously*, inside
 * the setter, before the state update that would otherwise make the refs
 * below stop reflecting the OLD rate:
 *
 *  1. `flush(now)` fires every click still due under the OLD tempo — so nothing
 *     between the last frame and this call is silently dropped.
 *  2. the anchor is recomputed so the SAME committed tick continues, only the
 *     rate after it changes.
 *
 * That ordering is what satisfies "changing bpm mid-run changes the
 * subsequent gaps and does not re-fire past clicks": `posTickRef` only ever
 * moves forward, and every call to `clicksInRange` asks for a range strictly
 * after the last one already handed to `AudioOutput`.
 *
 * All four setters funnel into one `apply(partial)` that merges onto a draft
 * ref written SYNCHRONOUSLY (roadmap T.9). Reading the render closure — or a
 * ref assigned during render, which is exactly as stale in-tick — meant a
 * second setter in the same tick rebuilt its draft from the pre-tick values
 * and silently undid the first: `setBpm(72)` then `setSubdivision(3)` in one
 * `act()` left bpm at 100. It also means a combination is validated as a
 * combination, so raising the tempo first can legitimately make the
 * subdivision that follows it in the same tick illegal.
 */
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import type { AudioOutput, Clock } from '@core/ports/index.ts'
import { bpm as asBpm, millis, ticks, type Bpm } from '@core/shared/units.ts'
import {
  clicksInRange,
  defaultAccents,
  MAX_BPM,
  MIN_BPM,
  validateMetronomeSettings,
  type AccentPattern,
  type Click,
  type MetronomeSettings,
  type Subdivision,
} from '@core/timing/metronome.ts'
import { makeTempoMap, tickToMs, msToTick, type TempoMap } from '@core/timing/tempo.ts'
import { useRef, useState } from 'react'
import { resizeAccents } from './AccentEditor.tsx'

const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
const DEFAULT_BPM = asBpm(100)
const DEFAULT_SUBDIVISION: Subdivision = 1

export type UseMetronomeOptions = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
  readonly initialBpm?: Bpm
  readonly initialTimeSignature?: TimeSignature
  readonly initialSubdivision?: Subdivision
  readonly initialAccents?: AccentPattern
}

export type MetronomeApi = {
  readonly running: boolean
  readonly bpm: Bpm
  readonly timeSignature: TimeSignature
  readonly subdivision: Subdivision
  readonly accents: AccentPattern
  /** The most recent click actually sent to `AudioOutput` — the beat readout's source. */
  readonly lastClick: Click | undefined
  /** Set when a proposed change would violate `validateMetronomeSettings`; the change is rejected. */
  readonly error: string | undefined
  readonly start: () => void
  readonly stop: () => void
  readonly setBpm: (bpm: number) => void
  readonly setTimeSignature: (timeSignature: TimeSignature) => void
  readonly setSubdivision: (subdivision: Subdivision) => void
  readonly setAccents: (accents: AccentPattern) => void
}

type Draft = {
  readonly bpm: Bpm
  readonly timeSignature: TimeSignature
  readonly subdivision: Subdivision
  readonly accents: AccentPattern
}

function draftSettings(draft: Draft): MetronomeSettings {
  return {
    bpm: draft.bpm,
    timeSignature: draft.timeSignature,
    subdivision: draft.subdivision,
    accents: draft.accents,
  }
}

export function useMetronome(options: UseMetronomeOptions = {}): MetronomeApi {
  const browserClockRef = useRef<Clock | undefined>(undefined)
  if (browserClockRef.current === undefined) browserClockRef.current = createBrowserClock()
  const clock = options.clock ?? browserClockRef.current

  const [bpmState, setBpmState] = useState<Bpm>(options.initialBpm ?? DEFAULT_BPM)
  const [timeSignature, setTimeSignatureState] = useState<TimeSignature>(
    options.initialTimeSignature ?? DEFAULT_TIME_SIGNATURE,
  )
  const [subdivision, setSubdivisionState] = useState<Subdivision>(
    options.initialSubdivision ?? DEFAULT_SUBDIVISION,
  )
  const [accents, setAccentsState] = useState<AccentPattern>(
    options.initialAccents ??
      defaultAccents(options.initialTimeSignature ?? DEFAULT_TIME_SIGNATURE),
  )
  const [running, setRunning] = useState(false)
  const [lastClick, setLastClick] = useState<Click | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const runningRef = useRef(running)
  runningRef.current = running

  // The authoritative settings, and the ONLY thing any setter reads (roadmap
  // T.9). Assigned during render it would be exactly as stale in-tick as the
  // render closure it replaced: React has not re-rendered yet when a second
  // setter runs in the same tick, so `bpmState` and friends still hold the
  // pre-tick values. `apply` writes this ref synchronously instead, so two
  // setters in one tick compose — the second validates against, and keeps,
  // what the first just set — and the frame pump (which runs outside render)
  // never acts on a settings object a setter has already superseded.
  const draftRef = useRef<Draft>({
    bpm: options.initialBpm ?? DEFAULT_BPM,
    timeSignature: options.initialTimeSignature ?? DEFAULT_TIME_SIGNATURE,
    subdivision: options.initialSubdivision ?? DEFAULT_SUBDIVISION,
    accents:
      options.initialAccents ??
      defaultAccents(options.initialTimeSignature ?? DEFAULT_TIME_SIGNATURE),
  })
  const tempoMapRef = useRef<TempoMap>(
    makeTempoMap([{ tick: ticks(0), bpm: draftRef.current.bpm }]),
  )

  /** The last tick committed to `AudioOutput` — only ever moves forward. */
  const posTickRef = useRef(0)
  /** The clock instant tick 0 is anchored to; see the module comment. */
  const originMsRef = useRef(0)
  const audioRef = useRef<AudioOutput | undefined>(options.audioOutput)
  if (options.audioOutput !== undefined) audioRef.current = options.audioOutput

  /** Advance the committed tick to `nowMs`, firing every click crossed on the way. */
  function flush(nowMs: number): void {
    if (!runningRef.current) return
    const map = tempoMapRef.current
    const settings = draftSettings(draftRef.current)
    const prevTick = posTickRef.current
    const rawTick = msToTick(map, millis(nowMs - originMsRef.current))
    const newTick = Math.max(prevTick, rawTick)
    if (newTick <= prevTick) return
    // A hidden tab (or any other frame gap) can leave a huge backlog between
    // pumps. Replaying all of it would either smash it into one simultaneous
    // burst (every click clamps to "now" at the audio adapter) or, past
    // MAX_CLICKS, throw inside the frame callback. Cap the catch-up to one
    // bar and silently skip the rest instead.
    const barTicks = measureDurationTicks(settings.timeSignature)
    if (newTick - prevTick > barTicks) {
      posTickRef.current = newTick
      return
    }
    const due = clicksInRange(settings, ticks(prevTick), ticks(newTick))
    const audio = audioRef.current
    // Anchor on the window START, like `usePracticeEngine.onFrame` does:
    // scheduling from the true origin would hand every click a timestamp at
    // or before `clock.now()`, which the real audio adapter clamps to the
    // frame instant (killing subdivision and burying simultaneous clicks).
    const anchorMs = nowMs - tickToMs(map, ticks(prevTick))
    if (audio !== undefined) {
      for (const click of due) audio.click(click.accented, millis(anchorMs + click.ms))
    }
    posTickRef.current = newTick
    const last = due[due.length - 1]
    if (last !== undefined) setLastClick(last)
  }

  useTransportLoop({
    active: running,
    onFrame: () => flush(clock.now()),
    ...(options.frameDriver === undefined ? {} : { driver: options.frameDriver }),
  })

  /**
   * Merge `partial` onto the live draft and commit it if the RESULT validates.
   * Every setter goes through here, so a change is judged against the settings
   * as they stand at the instant of the call, not as they stood at the last
   * render.
   */
  function apply(partial: Partial<Draft>): boolean {
    const draft: Draft = { ...draftRef.current, ...partial }
    const validated = validateMetronomeSettings(draftSettings(draft))
    if (!validated.ok) {
      setError(validated.error)
      return false
    }
    setError(undefined)
    if (draft.bpm !== draftRef.current.bpm) {
      const newMap = makeTempoMap([{ tick: ticks(0), bpm: draft.bpm }])
      if (runningRef.current) {
        const nowMs = clock.now()
        // Flush under the OLD tempo — `draftRef` and `tempoMapRef` are both
        // still the old ones on this line, and both are replaced below — so
        // nothing already due is lost, then reanchor so the committed tick
        // continues unbroken at the NEW rate.
        flush(nowMs)
        originMsRef.current = nowMs - tickToMs(newMap, ticks(posTickRef.current))
      }
      // Swapped whether or not the transport is running: a tempo set BEFORE
      // Start must be the tempo Start runs at, and nothing else refreshes
      // this ref now that it is no longer re-assigned from a render memo.
      tempoMapRef.current = newMap
    }
    draftRef.current = draft
    setBpmState(draft.bpm)
    setTimeSignatureState(draft.timeSignature)
    setSubdivisionState(draft.subdivision)
    setAccentsState(draft.accents)
    return true
  }

  function start(): void {
    const validated = validateMetronomeSettings(draftSettings(draftRef.current))
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setError(undefined)
    if (audioRef.current === undefined) audioRef.current = createDefaultAudioOutput()
    posTickRef.current = 0
    originMsRef.current = clock.now()
    setLastClick(undefined)
    setRunning(true)
  }

  function stop(): void {
    // The ref must flip before `setRunning` — `flush` reads `runningRef`, not
    // `running`, and a frame landing between this call and the next commit
    // must see "stopped" immediately, not replay the whole run in one burst
    // (roadmap 2.11a's "state reaches the loop only on the next commit").
    runningRef.current = false
    setRunning(false)
    posTickRef.current = 0
    audioRef.current?.allNotesOff()
  }

  function setBpm(value: number): void {
    const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, value))
    apply({ bpm: asBpm(clamped) })
  }

  function setTimeSignature(next: TimeSignature): void {
    // `resizeAccents` calls into `defaultAccents` -> `beatTicks`, which
    // *invariants* on the shape (programmer error, not user input). Guard
    // here first so an emptied or zeroed Beats field is rejected the same
    // way `validateMetronomeSettings` rejects it elsewhere, instead of
    // throwing out of the change handler.
    if (!Number.isInteger(next.beats) || next.beats <= 0) {
      setError(`bad time signature beats: ${next.beats}`)
      return
    }
    apply({ timeSignature: next, accents: resizeAccents(draftRef.current.accents, next) })
  }

  function setSubdivision(next: Subdivision): void {
    apply({ subdivision: next })
  }

  function setAccents(next: AccentPattern): void {
    apply({ accents: next })
  }

  return {
    running,
    bpm: bpmState,
    timeSignature,
    subdivision,
    accents,
    lastClick,
    error,
    start,
    stop,
    setBpm,
    setTimeSignature,
    setSubdivision,
    setAccents,
  }
}
