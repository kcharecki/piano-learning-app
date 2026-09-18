/**
 * `useDrumMidiInput` (roadmap DR-02, app slice): proves the join between
 * `useMidiConnection` and the kit-map engine — mapped strokes reach `onHit`,
 * chokes and note-off/sustain never do, an unmapped note is tracked without
 * being lost, the engine's own debounce survives across renders, and the
 * subscription reads the latest `onHit` without resubscribing.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FakeMidiInput } from '@test/fakes.ts'
import { midi, millis } from '@core/shared/units.ts'
import { ekitStatusText, useDrumMidiInput } from './useDrumMidiInput.ts'

describe('useDrumMidiInput', () => {
  it('calls onHit once for a mapped stroke, with the pad and the note-on velocity', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))

    act(() => {
      input.emit({ type: 'noteOn', note: midi(38), velocity: 100, time: millis(0) })
    })

    expect(onHit).toHaveBeenCalledTimes(1)
    const [pad, hit] = onHit.mock.calls[0] as [string, { velocity: number }]
    expect(pad).toBe('snare')
    expect(hit.velocity).toBe(100)
  })

  it('resolves the hi-hat pad from the CC#4 state seen before the note-on', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))

    act(() => {
      input.emit({ type: 'controlChange', controller: 4, value: 0, time: millis(0) })
      input.emit({ type: 'noteOn', note: midi(46), velocity: 90, time: millis(1) })
    })
    expect(onHit.mock.calls[0]?.[0]).toBe('hhOpen')

    act(() => {
      input.emit({ type: 'controlChange', controller: 4, value: 127, time: millis(100) })
      input.emit({ type: 'noteOn', note: midi(42), velocity: 90, time: millis(101) })
    })
    expect(onHit.mock.calls[1]?.[0]).toBe('hhClosed')
  })

  it('tracks the last unmapped note without calling onHit, and a later mapped hit does not clear it', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    const { result } = renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))

    act(() => {
      input.emit({ type: 'noteOn', note: midi(61), velocity: 90, time: millis(0) })
    })
    expect(onHit).not.toHaveBeenCalled()
    expect(result.current.lastUnmappedNote).toBe(61)

    act(() => {
      input.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(100) })
    })
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(result.current.lastUnmappedNote).toBe(61)
  })

  it('debounces a same-pad double-trigger within 20ms but not one 50ms apart', () => {
    const inputClose = new FakeMidiInput()
    const onHitClose = vi.fn()
    renderHook(() => useDrumMidiInput({ onHit: onHitClose, midiInput: inputClose }))
    act(() => {
      inputClose.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(0) })
      inputClose.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(10) })
    })
    expect(onHitClose).toHaveBeenCalledTimes(1)

    const inputFar = new FakeMidiInput()
    const onHitFar = vi.fn()
    renderHook(() => useDrumMidiInput({ onHit: onHitFar, midiInput: inputFar }))
    act(() => {
      inputFar.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(0) })
      inputFar.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(50) })
    })
    expect(onHitFar).toHaveBeenCalledTimes(2)
  })

  it('does not call onHit for a choke gesture (poly aftertouch)', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))

    act(() => {
      input.emit({ type: 'noteOn', note: midi(49), velocity: 100, time: millis(0) })
    })
    expect(onHit).toHaveBeenCalledTimes(1)
    onHit.mockClear()

    act(() => {
      input.emit({ type: 'polyAftertouch', note: midi(49), pressure: 80, time: millis(100) })
    })
    expect(onHit).not.toHaveBeenCalled()
  })

  it('produces no output for noteOff or sustain', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))

    act(() => {
      input.emit({ type: 'noteOff', note: midi(38), time: millis(0) })
      input.emit({ type: 'sustain', down: true, time: millis(0) })
    })
    expect(onHit).not.toHaveBeenCalled()
  })

  it('reports connected true and the exact status text for the default fake device', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    const { result } = renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))
    const deviceName = input.listDevices()[0]?.name

    expect(result.current.connected).toBe(true)
    expect(result.current.statusText).toBe(`E-kit: ${deviceName} · General MIDI map`)

    act(() => {
      input.emit({ type: 'noteOn', note: midi(61), velocity: 90, time: millis(0) })
    })
    expect(result.current.statusText).toBe(
      `E-kit: ${deviceName} · General MIDI map · a pad sent note 61, which is not in the map`,
    )
  })

  it('stops calling onHit after unmount', () => {
    const input = new FakeMidiInput()
    const onHit = vi.fn()
    const { unmount } = renderHook(() => useDrumMidiInput({ onHit, midiInput: input }))
    unmount()

    act(() => {
      input.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(0) })
    })
    expect(onHit).not.toHaveBeenCalled()
  })

  it('reads the latest onHit through a ref, so a new identity is used for the next event', () => {
    const input = new FakeMidiInput()
    const onHitA = vi.fn()
    const { rerender } = renderHook(({ onHit }) => useDrumMidiInput({ onHit, midiInput: input }), {
      initialProps: { onHit: onHitA },
    })

    const onHitB = vi.fn()
    rerender({ onHit: onHitB })

    act(() => {
      input.emit({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(0) })
    })
    expect(onHitA).not.toHaveBeenCalled()
    expect(onHitB).toHaveBeenCalledTimes(1)
  })
})

describe('ekitStatusText', () => {
  it('renders the connected, unmapped-suffix, error and disconnected branches exactly', () => {
    expect(
      ekitStatusText(
        { connected: true, deviceName: 'TD-17', connectionError: undefined, lastUnmappedNote: undefined },
        'General MIDI',
      ),
    ).toBe('E-kit: TD-17 · General MIDI map')

    expect(
      ekitStatusText(
        { connected: true, deviceName: 'TD-17', connectionError: undefined, lastUnmappedNote: 61 },
        'General MIDI',
      ),
    ).toBe('E-kit: TD-17 · General MIDI map · a pad sent note 61, which is not in the map')

    expect(
      ekitStatusText(
        { connected: false, deviceName: undefined, connectionError: 'no access', lastUnmappedNote: undefined },
        'General MIDI',
      ),
    ).toBe('No e-kit: no access')

    expect(
      ekitStatusText(
        { connected: false, deviceName: undefined, connectionError: undefined, lastUnmappedNote: undefined },
        'General MIDI',
      ),
    ).toBe('No e-kit connected — the pads and keys below still work')
  })
})
