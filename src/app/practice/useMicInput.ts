/**
 * Microphone input connection for the practice screen (roadmap 5.7 / B.1,
 * REQ-3.3.7) — the `useMidiConnection` sibling for the microphone fallback.
 * Unlike a MIDI connection this is opt-in and disposable: a microphone
 * stream holds the browser's recording indicator lit and the hardware open,
 * so it is only requested when `enable()` is called, and torn down on
 * `disable()` or unmount, never left running in the background.
 *
 * `connect` is the injection seam (mirrors `ConnectMidi`); tests never touch
 * real `getUserMedia`.
 */
import { createMicPitchInput, type MicPitchInput } from '@adapters/audio/micPitchInput.ts'
import type { Result } from '@core/shared/result.ts'
import { useEffect, useState } from 'react'

export type ConnectMic = () => Promise<Result<MicPitchInput, string>>

export type UseMicInputOptions = {
  /** Overrides how a real connection is made. Defaults to the real microphone adapter. */
  readonly connect?: ConnectMic
}

export type MicInputState = {
  readonly enabled: boolean
  /** Present once permission is granted and the capture loop is running; `undefined` while connecting, disabled, or after an error. */
  readonly input: MicPitchInput | undefined
  /** Set when a connection attempt failed — cleared on the next `enable()`. */
  readonly error: string | undefined
  readonly enable: () => void
  readonly disable: () => void
}

async function defaultConnect(): Promise<Result<MicPitchInput, string>> {
  return createMicPitchInput()
}

export function useMicInput(options: UseMicInputOptions = {}): MicInputState {
  const { connect = defaultConnect } = options
  const [enabled, setEnabled] = useState(false)
  const [input, setInput] = useState<MicPitchInput | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    let dispose: (() => void) | undefined

    connect()
      .then((result) => {
        if (cancelled) {
          // `disable()` (or unmount) fired while the permission prompt was
          // still pending — the input arrived too late to use, but it still
          // opened the microphone, so it must still be torn down.
          if (result.ok) result.value.dispose()
          return
        }
        if (result.ok) {
          setInput(result.value)
          dispose = () => result.value.dispose()
        } else {
          setError(result.error)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      cancelled = true
      dispose?.()
      setInput(undefined)
    }
  }, [enabled, connect])

  return {
    enabled,
    input,
    error,
    enable: (): void => {
      setError(undefined)
      setEnabled(true)
    },
    disable: (): void => setEnabled(false),
  }
}
