/**
 * The fakes are test infrastructure, so they get tested too — a bug in
 * FakeClock's ordering would silently corrupt every timing test downstream.
 */
import { describe, expect, it, vi } from 'vitest'
import { midi, millis } from '@core/shared/units.ts'
import { FakeClock, FakeMidiInput, MemoryStore, RecordingAudioOutput, scriptedRng } from './fakes.ts'

describe('FakeClock', () => {
  it('starts where it is told and only moves when advanced', () => {
    const clock = new FakeClock(1000)
    expect(clock.now()).toBe(1000)
    clock.advance(250)
    expect(clock.now()).toBe(1250)
  })

  it('fires scheduled callbacks in chronological order, not insertion order', () => {
    const clock = new FakeClock()
    const fired: string[] = []
    clock.schedule(300, () => fired.push('third'))
    clock.schedule(100, () => fired.push('first'))
    clock.schedule(200, () => fired.push('second'))
    clock.advance(500)
    expect(fired).toEqual(['first', 'second', 'third'])
  })

  it('breaks ties by insertion order', () => {
    const clock = new FakeClock()
    const fired: string[] = []
    clock.schedule(100, () => fired.push('a'))
    clock.schedule(100, () => fired.push('b'))
    clock.advance(100)
    expect(fired).toEqual(['a', 'b'])
  })

  it('exposes the correct time inside a callback', () => {
    const clock = new FakeClock()
    let observed = -1
    clock.schedule(150, () => {
      observed = clock.now()
    })
    clock.advance(1000)
    expect(observed).toBe(150)
    expect(clock.now()).toBe(1000)
  })

  it('runs callbacks scheduled from within a callback in the same advance', () => {
    const clock = new FakeClock()
    const fired: number[] = []
    clock.schedule(100, () => {
      fired.push(clock.now())
      clock.schedule(100, () => fired.push(clock.now()))
    })
    clock.advance(300)
    expect(fired).toEqual([100, 200])
  })

  it('does not fire callbacks past the advance target', () => {
    const clock = new FakeClock()
    const fn = vi.fn()
    clock.schedule(500, fn)
    clock.advance(499)
    expect(fn).not.toHaveBeenCalled()
    clock.advance(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancels', () => {
    const clock = new FakeClock()
    const fn = vi.fn()
    const handle = clock.schedule(100, fn)
    clock.cancel(handle)
    clock.advance(1000)
    expect(fn).not.toHaveBeenCalled()
    expect(clock.pendingCount).toBe(0)
  })

  it('refuses to go backwards', () => {
    const clock = new FakeClock(500)
    expect(() => clock.setTime(400)).toThrow(/backwards/)
    clock.setTime(900)
    expect(clock.now()).toBe(900)
  })

  it('serves as a DateSource', () => {
    const clock = new FakeClock(1_700_000_000_000)
    expect(clock.epochMillis()).toBe(1_700_000_000_000)
  })
})

describe('scriptedRng', () => {
  it('returns the scripted values then cycles', () => {
    const rng = scriptedRng([0.1, 0.5, 0.9])
    expect([rng.next(), rng.next(), rng.next(), rng.next()]).toEqual([0.1, 0.5, 0.9, 0.1])
  })

  it('rejects an empty script', () => {
    expect(() => scriptedRng([])).toThrow()
  })
})

describe('RecordingAudioOutput', () => {
  it('records calls with the clock time when no explicit time is given', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    audio.noteOn(midi(60), 100)
    clock.advance(500)
    audio.noteOff(midi(60))
    expect(audio.calls).toEqual([
      { kind: 'noteOn', note: 60, velocity: 100, at: 0 },
      { kind: 'noteOff', note: 60, at: 500 },
    ])
  })

  it('honours an explicit scheduled time', () => {
    const audio = new RecordingAudioOutput(new FakeClock())
    audio.noteOn(midi(64), 80, millis(1234))
    expect(audio.calls[0]).toMatchObject({ at: 1234 })
  })

  it('summarises played notes and clicks', () => {
    const audio = new RecordingAudioOutput(new FakeClock())
    audio.noteOn(midi(60), 80)
    audio.click(true)
    audio.noteOn(midi(64), 80)
    audio.click(false)
    expect(audio.playedNotes).toEqual([60, 64])
    expect(audio.clicks).toEqual([
      { accented: true, at: 0 },
      { accented: false, at: 0 },
    ])
  })

  it('resets', () => {
    const audio = new RecordingAudioOutput(new FakeClock())
    audio.noteOn(midi(60), 80)
    audio.reset()
    expect(audio.calls).toEqual([])
  })
})

describe('FakeMidiInput', () => {
  it('delivers events to every subscriber until unsubscribed', () => {
    const input = new FakeMidiInput()
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = input.onEvent(a)
    input.onEvent(b)
    input.emit({ type: 'noteOn', note: midi(60), velocity: 90, time: millis(0) })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    unsubA()
    input.emit({ type: 'noteOn', note: midi(62), velocity: 90, time: millis(10) })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('play() emits a matched note-on/note-off pair', () => {
    const input = new FakeMidiInput()
    const events: string[] = []
    input.onEvent((e) => events.push(`${e.type}@${'time' in e ? e.time : ''}`))
    input.play(midi(60), 100, 250)
    expect(events).toEqual(['noteOn@100', 'noteOff@350'])
  })

  it('reports device hot-plug', () => {
    const input = new FakeMidiInput()
    const handler = vi.fn()
    input.onDevicesChanged(handler)
    input.setDevices([{ id: 'x', name: 'New Piano', manufacturer: 'Acme' }])
    expect(handler).toHaveBeenCalledWith([{ id: 'x', name: 'New Piano', manufacturer: 'Acme' }])
    expect(input.listDevices()).toHaveLength(1)
  })

  it('selects the first device by default and allows overriding', () => {
    const input = new FakeMidiInput()
    expect(input.selectedDeviceId).toBe('fake-piano')
    input.selectDevice(null)
    expect(input.selectedDeviceId).toBeNull()
  })
})

describe('MemoryStore', () => {
  it('round-trips values', async () => {
    const store = new MemoryStore()
    await store.put('scores', 's1', { title: 'Minuet' })
    expect(await store.get('scores', 's1')).toEqual({ title: 'Minuet' })
    expect(await store.get('scores', 'missing')).toBeUndefined()
  })

  it('clones on write and on read so callers cannot mutate stored state', async () => {
    const store = new MemoryStore()
    const value = { tags: ['a'] }
    await store.put('scores', 's1', value)
    value.tags.push('b')
    const read = await store.get<{ tags: string[] }>('scores', 's1')
    expect(read).toEqual({ tags: ['a'] })
    read!.tags.push('c')
    expect(await store.get('scores', 's1')).toEqual({ tags: ['a'] })
  })

  it('lists, deletes and clears', async () => {
    const store = new MemoryStore()
    await store.put('scores', 'a', 1)
    await store.put('scores', 'b', 2)
    expect((await store.getAll<number>('scores')).sort()).toEqual([1, 2])
    await store.delete('scores', 'a')
    expect(await store.getAll('scores')).toEqual([2])
    await store.clear('scores')
    expect(await store.getAll('scores')).toEqual([])
  })

  it('reports only non-empty collections', async () => {
    const store = new MemoryStore()
    expect(await store.collections()).toEqual([])
    await store.put('progress', 'p', {})
    await store.getAll('scores') // touching must not create a visible collection
    expect(await store.collections()).toEqual(['progress'])
  })
})
