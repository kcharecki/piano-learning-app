/**
 * Audio recording (roadmap B.5, REQ-3.9.2 "audio recording is optional") —
 * the DOM edge that captures a `MediaStream` into a single `Blob` via
 * `MediaRecorder`, and a small playback wrapper for replaying that `Blob`
 * back. Both are pure adapters: no core import beyond `Result`, no timing or
 * alignment decisions — `useAudioRecording` (`app/practice/useRecorder.ts`)
 * owns when to call `start`/`stop`/`play` and how to line the result up
 * against a `MidiRecorder`'s own timeline.
 *
 * Mirrors `micPitchInput.ts`'s contract on purpose: `getUserMedia` and
 * `createRecorder` are both test seams, permission denial / no input device /
 * an unsupported browser all come back as `err(...)` rather than a throw, and
 * `dispose()` stops every track exactly once.
 *
 * ## Mime type
 *
 * `MediaRecorder` support for a given container/codec varies by browser and
 * OS (Chrome ships opus-in-webm, Safari ships aac-in-mp4, neither ships the
 * other) — hardcoding one would make recording silently fail, or throw at
 * construction, on whichever browser does not support it. `PREFERRED_MIME_TYPES`
 * is an ordered wishlist; the first entry `MediaRecorder.isTypeSupported`
 * actually accepts is what gets used, and the chosen type is reported back on
 * `AudioRecorder.mimeType` so storage can record what the blob actually is.
 * Only if NONE of the wishlist (nor anything at all, on a browser with no
 * `MediaRecorder`) is supported does this come back `err(...)`.
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { describeMicError } from './micErrorMessage.ts'

/**
 * Ordered by how broadly-compatible + efficient the encoding is: opus-in-webm
 * first (small, good quality, Chromium/Firefox), plain webm/ogg next, mp4/aac
 * last (Safari's only option, and the format `isTypeSupported` gates the
 * others behind on that browser). Feature-detected via `isTypeSupported`, not
 * assumed — see the module comment.
 */
export const PREFERRED_MIME_TYPES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
]

export type AudioRecorder = {
  /** The mime type `MediaRecorder` was actually constructed with — feature-detected, never hardcoded. */
  readonly mimeType: string
  /** `MediaRecorder.state`, so a caller can tell an already-started recorder from a fresh one. */
  readonly state: 'inactive' | 'recording'
  /** Begins capturing. No-op if already recording or disposed. */
  start(): void
  /**
   * Stops capturing and resolves with everything captured since `start()` as
   * one `Blob`. Resolves to an empty `Blob` (still carrying `mimeType`) if
   * `start()` was never called or capture was already stopped — a caller
   * that calls `stop()` defensively should never have to special-case that.
   */
  stop(): Promise<Blob>
  /** Stops any in-progress capture and releases every microphone track. Call once, on unmount/disable. */
  dispose(): void
}

/** The subset of the real `MediaRecorder` this module drives — the test seam's shape. */
export type MediaRecorderLike = {
  readonly state: 'inactive' | 'recording' | 'paused'
  start(): void
  stop(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
}

export type AudioRecorderOptions = {
  /** Test seam for `navigator.mediaDevices.getUserMedia`. */
  readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  /** Test seam for `MediaRecorder.isTypeSupported`. Defaults to the real static method. */
  readonly isTypeSupported?: (mimeType: string) => boolean
  /** Test seam for `new MediaRecorder(stream, { mimeType })`. */
  readonly createRecorder?: (stream: MediaStream, mimeType: string) => MediaRecorderLike
  /** Candidate mime types, most-preferred first. Defaults to `PREFERRED_MIME_TYPES`. */
  readonly mimeTypes?: readonly string[]
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    return Promise.reject(new Error('getUserMedia is not available in this browser.'))
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}

/** `false` for every candidate when the browser has no `MediaRecorder` at all — the two "unsupported" cases collapse into one error path. */
function defaultIsTypeSupported(mimeType: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)
}

function defaultCreateRecorder(stream: MediaStream, mimeType: string): MediaRecorderLike {
  return new MediaRecorder(stream, { mimeType }) as unknown as MediaRecorderLike
}

function stopAllTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Request microphone access and wrap it as an `AudioRecorder`. Never throws —
 * permission denial, no microphone, and no supported recording format all
 * come back as `err(...)`.
 */
export async function createAudioRecorder(
  options: AudioRecorderOptions = {},
): Promise<Result<AudioRecorder, string>> {
  const getUserMedia = options.getUserMedia ?? defaultGetUserMedia
  const isTypeSupported = options.isTypeSupported ?? defaultIsTypeSupported
  const createRecorder = options.createRecorder ?? defaultCreateRecorder
  const candidates = options.mimeTypes ?? PREFERRED_MIME_TYPES

  let stream: MediaStream
  try {
    stream = await getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch (cause) {
    return err(describeMicError('createAudioRecorder', cause))
  }

  const mimeType = candidates.find((type) => isTypeSupported(type))
  if (mimeType === undefined) {
    stopAllTracks(stream)
    return err('No supported audio recording format is available in this browser.')
  }

  const mediaRecorder = createRecorder(stream, mimeType)
  const chunks: Blob[] = []
  let disposed = false
  let pendingStop: ((blob: Blob) => void) | undefined

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType })
    chunks.length = 0
    const resolve = pendingStop
    pendingStop = undefined
    resolve?.(blob)
  }

  return ok({
    mimeType,
    get state(): 'inactive' | 'recording' {
      return mediaRecorder.state === 'recording' ? 'recording' : 'inactive'
    },
    start(): void {
      if (disposed || mediaRecorder.state !== 'inactive') return
      chunks.length = 0
      mediaRecorder.start()
    },
    stop(): Promise<Blob> {
      if (disposed || mediaRecorder.state === 'inactive') {
        return Promise.resolve(new Blob([], { type: mimeType }))
      }
      return new Promise<Blob>((resolve) => {
        pendingStop = resolve
        mediaRecorder.stop()
      })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
      stopAllTracks(stream)
    },
  })
}

// ------------------------------------------------------------------ playback

export type AudioPlayback = {
  /**
   * Starts playback from `fromSeconds` (default 0) into the clip — used when
   * the audio's own first sample falls BEFORE the point replay is resuming
   * from, so the first `-offsetMs` of the clip must be skipped rather than
   * played early. See `useAudioRecording`'s alignment comment.
   */
  play(fromSeconds?: number): void
  stop(): void
  /** Pauses, releases the object URL. Call once, when the replay ends or the panel unmounts. */
  dispose(): void
}

export type AudioPlaybackOptions = {
  /** Test seam for the underlying element. Defaults to `new Audio()`. */
  readonly createElement?: () => HTMLAudioElement
  /** Test seam for `URL.createObjectURL`. */
  readonly createObjectUrl?: (blob: Blob) => string
  /** Test seam for `URL.revokeObjectURL`. */
  readonly revokeObjectUrl?: (url: string) => void
}

/**
 * Wraps a recorded `Blob` in a playable `HTMLAudioElement`. Construction
 * never fails — a bad blob simply fails to play, same as a corrupt
 * `<audio src>` would.
 *
 * When using the REAL default element (no `createElement` test seam
 * supplied), the element is attached to `document.body` — hidden
 * (`display: none`, so it never appears in a screenshot or the visual pass)
 * — for the whole of its lifetime, removed again in `dispose()`. An
 * `HTMLAudioElement` does not need to be in the document to play, but a
 * detached one is otherwise unobservable from outside this module; attaching
 * it is what makes "replay actually plays the audio" something a test (or a
 * browser devtools session) can check directly, rather than only trusting
 * that `play()` was called.
 */
export function createAudioPlayback(blob: Blob, options: AudioPlaybackOptions = {}): AudioPlayback {
  const usingRealElement = options.createElement === undefined
  const createElement = options.createElement ?? (() => new Audio())
  const createObjectUrl = options.createObjectUrl ?? ((b: Blob) => URL.createObjectURL(b))
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))

  const audio = createElement()
  const url = createObjectUrl(blob)
  audio.src = url
  if (usingRealElement && typeof document !== 'undefined') {
    audio.style.display = 'none'
    document.body.appendChild(audio)
  }
  let disposed = false

  return {
    play(fromSeconds = 0): void {
      if (disposed) return
      audio.currentTime = fromSeconds
      void audio.play().catch(() => {
        // Autoplay/decoding failures surface as a rejected promise, not a
        // throw — nothing here can usefully recover, and letting it reject
        // silently is strictly better than crashing the replay it was
        // attached to.
      })
    },
    stop(): void {
      if (disposed) return
      audio.pause()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      audio.pause()
      revokeObjectUrl(url)
      if (usingRealElement && typeof document !== 'undefined' && audio.parentNode !== null) {
        audio.parentNode.removeChild(audio)
      }
    },
  }
}
