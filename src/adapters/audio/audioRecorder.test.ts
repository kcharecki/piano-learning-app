/**
 * The `ui` (happy-dom) project has no real `getUserMedia`/`MediaRecorder`, so
 * every test fakes both by hand — same approach as `micPitchInput.test.ts`.
 * Assertions are on the `Result`/`Blob`/mime-type contract `createAudioRecorder`
 * promises, never on internals of the fakes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isErr, isOk, unwrap } from '@core/shared/result.ts'
import {
  createAudioPlayback,
  createAudioRecorder,
  PREFERRED_MIME_TYPES,
  type MediaRecorderLike,
} from './audioRecorder.ts'

class FakeMediaStreamTrack {
  stopped = false
  stop(): void {
    this.stopped = true
  }
}

class FakeMediaStream {
  readonly tracks = [new FakeMediaStreamTrack(), new FakeMediaStreamTrack()]
  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks
  }
}

class FakeMediaRecorder implements MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  startCalls = 0
  stopCalls = 0
  /** Chunks the test wants delivered on the next `stop()`, via `ondataavailable`. */
  chunksOnStop: Blob[] = []

  start(): void {
    this.startCalls += 1
    this.state = 'recording'
  }

  stop(): void {
    this.stopCalls += 1
    this.state = 'inactive'
    for (const chunk of this.chunksOnStop) this.ondataavailable?.({ data: chunk })
    this.onstop?.()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAudioRecorder', () => {
  it('requests the microphone and picks the first supported mime type', async () => {
    const stream = new FakeMediaStream()
    const fakeRecorder = new FakeMediaRecorder()
    const createRecorder = vi.fn(() => fakeRecorder)

    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(stream as unknown as MediaStream),
      isTypeSupported: (type) => type === 'audio/ogg',
      createRecorder,
    })

    expect(isOk(result)).toBe(true)
    const recorder = unwrap(result)
    expect(recorder.mimeType).toBe('audio/ogg')
    expect(createRecorder).toHaveBeenCalledWith(stream, 'audio/ogg')
  })

  it('prefers earlier candidates in PREFERRED_MIME_TYPES over later ones', async () => {
    const supported = new Set(['audio/webm', 'audio/mp4'])
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(new FakeMediaStream() as unknown as MediaStream),
      isTypeSupported: (type) => supported.has(type),
      createRecorder: () => new FakeMediaRecorder(),
    })

    expect(unwrap(result).mimeType).toBe('audio/webm')
    expect(PREFERRED_MIME_TYPES.indexOf('audio/webm')).toBeLessThan(
      PREFERRED_MIME_TYPES.indexOf('audio/mp4'),
    )
  })

  it('returns err with learner-safe copy, never the raw browser exception, on permission denial — and never opens a recorder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const createRecorder = vi.fn()
    const denied = new DOMException('Permission denied by the user', 'NotAllowedError')
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.reject(denied),
      createRecorder,
    })

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toMatch(/blocked microphone access/i)
      expect(result.error).not.toMatch(/Permission denied by the user/)
    }
    expect(createRecorder).not.toHaveBeenCalled()
    // The raw browser exception still reaches a developer — just not the screen.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('getUserMedia failed'), denied)
    warn.mockRestore()
  })

  it('returns err on no input device (getUserMedia rejects with NotFoundError), with distinct learner copy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notFound = new DOMException('Requested device not found', 'NotFoundError')
    const result = await createAudioRecorder({ getUserMedia: () => Promise.reject(notFound) })

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toMatch(/no microphone was found/i)
      expect(result.error).not.toMatch(/Requested device not found/)
    }
  })

  it('keeps the two failure messages distinct: no device found vs. refused permission', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notFound = await createAudioRecorder({
      getUserMedia: () => Promise.reject(new DOMException('none', 'NotFoundError')),
    })
    const refused = await createAudioRecorder({
      getUserMedia: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    })

    expect(isErr(notFound)).toBe(true)
    expect(isErr(refused)).toBe(true)
    if (isErr(notFound) && isErr(refused)) {
      expect(notFound.error).not.toBe(refused.error)
    }
  })

  it('returns err when no candidate mime type is supported, and stops every track', async () => {
    const stream = new FakeMediaStream()
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(stream as unknown as MediaStream),
      isTypeSupported: () => false,
    })

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error).toMatch(/no supported/i)
    expect(stream.tracks.every((t) => t.stopped)).toBe(true)
  })

  it('start() begins capture; stop() resolves with everything captured as one Blob of the chosen mime type', async () => {
    const fakeRecorder = new FakeMediaRecorder()
    fakeRecorder.chunksOnStop = [new Blob(['abc'], { type: 'audio/webm' })]
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(new FakeMediaStream() as unknown as MediaStream),
      isTypeSupported: (type) => type === 'audio/webm;codecs=opus',
      createRecorder: () => fakeRecorder,
    })
    const recorder = unwrap(result)

    recorder.start()
    expect(fakeRecorder.startCalls).toBe(1)
    expect(recorder.state).toBe('recording')

    const blob = await recorder.stop()
    expect(fakeRecorder.stopCalls).toBe(1)
    expect(blob.type).toBe('audio/webm;codecs=opus')
    expect(await blob.text()).toBe('abc')
    expect(recorder.state).toBe('inactive')
  })

  it('stop() without a prior start() resolves an empty Blob rather than hanging or throwing', async () => {
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(new FakeMediaStream() as unknown as MediaStream),
      isTypeSupported: () => true,
      createRecorder: () => new FakeMediaRecorder(),
    })
    const recorder = unwrap(result)

    const blob = await recorder.stop()
    expect(blob.size).toBe(0)
  })

  it('start() is a no-op while already recording', async () => {
    const fakeRecorder = new FakeMediaRecorder()
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(new FakeMediaStream() as unknown as MediaStream),
      isTypeSupported: () => true,
      createRecorder: () => fakeRecorder,
    })
    const recorder = unwrap(result)

    recorder.start()
    recorder.start()
    expect(fakeRecorder.startCalls).toBe(1)
  })

  it('dispose() stops every track and stops an in-progress recording', async () => {
    const stream = new FakeMediaStream()
    const fakeRecorder = new FakeMediaRecorder()
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(stream as unknown as MediaStream),
      isTypeSupported: () => true,
      createRecorder: () => fakeRecorder,
    })
    const recorder = unwrap(result)

    recorder.start()
    recorder.dispose()

    expect(fakeRecorder.stopCalls).toBe(1)
    expect(stream.tracks.every((t) => t.stopped)).toBe(true)
  })

  it('dispose() is idempotent and safe when nothing was ever started', async () => {
    const stream = new FakeMediaStream()
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(stream as unknown as MediaStream),
      isTypeSupported: () => true,
      createRecorder: () => new FakeMediaRecorder(),
    })
    const recorder = unwrap(result)

    recorder.dispose()
    recorder.dispose()
    expect(stream.tracks.every((t) => t.stopped)).toBe(true)
  })

  it('start()/stop() after dispose() is a no-op, not a throw', async () => {
    const fakeRecorder = new FakeMediaRecorder()
    const result = await createAudioRecorder({
      getUserMedia: () => Promise.resolve(new FakeMediaStream() as unknown as MediaStream),
      isTypeSupported: () => true,
      createRecorder: () => fakeRecorder,
    })
    const recorder = unwrap(result)
    recorder.dispose()

    expect(() => recorder.start()).not.toThrow()
    expect(fakeRecorder.startCalls).toBe(0)
    await expect(recorder.stop()).resolves.toBeInstanceOf(Blob)
  })
})

describe('createAudioPlayback', () => {
  function fakeAudioElement() {
    return {
      src: '',
      currentTime: 0,
      playCalls: [] as number[],
      pauseCalls: 0,
      play(): Promise<void> {
        this.playCalls.push(this.currentTime)
        return Promise.resolve()
      },
      pause(): void {
        this.pauseCalls += 1
      },
    }
  }

  it('assigns an object URL for the blob and plays from the start by default', () => {
    const element = fakeAudioElement()
    const blob = new Blob(['x'], { type: 'audio/webm' })
    const createObjectUrl = vi.fn(() => 'blob:fake-url')
    const revokeObjectUrl = vi.fn()

    const playback = createAudioPlayback(blob, {
      createElement: () => element as unknown as HTMLAudioElement,
      createObjectUrl,
      revokeObjectUrl,
    })

    expect(createObjectUrl).toHaveBeenCalledWith(blob)
    expect(element.src).toBe('blob:fake-url')

    playback.play()
    expect(element.playCalls).toEqual([0])
  })

  it('play(fromSeconds) seeks before playing — the negative-offset alignment case', () => {
    const element = fakeAudioElement()
    const playback = createAudioPlayback(new Blob(), {
      createElement: () => element as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:fake-url',
      revokeObjectUrl: () => {},
    })

    playback.play(0.35)
    expect(element.currentTime).toBe(0.35)
    expect(element.playCalls).toEqual([0.35])
  })

  it('stop() pauses without disposing — play() still works afterwards', () => {
    const element = fakeAudioElement()
    const playback = createAudioPlayback(new Blob(), {
      createElement: () => element as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:fake-url',
      revokeObjectUrl: () => {},
    })

    playback.stop()
    expect(element.pauseCalls).toBe(1)
    playback.play()
    expect(element.playCalls).toEqual([0])
  })

  it('dispose() pauses, revokes the object URL, and further calls are no-ops', () => {
    const element = fakeAudioElement()
    const revokeObjectUrl = vi.fn()
    const playback = createAudioPlayback(new Blob(), {
      createElement: () => element as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:fake-url',
      revokeObjectUrl,
    })

    playback.dispose()
    expect(element.pauseCalls).toBe(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:fake-url')

    playback.play()
    playback.dispose()
    expect(element.playCalls).toEqual([])
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1)
  })
})
