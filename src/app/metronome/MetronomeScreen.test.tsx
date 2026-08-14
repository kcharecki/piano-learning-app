/**
 * `MetronomeScreen` (roadmap 2.28, REQ-3.9.1): the standalone metronome is
 * wired end to end and usable with no score loaded at all — starting it
 * actually produces clicks, and stopping actually silences them. Per-hook
 * scheduling detail (gaps, accents, bpm changes) is `useMetronome.test.ts`'s
 * job; this only proves the screen's wiring drives real output.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { MetronomeScreen } from './MetronomeScreen.tsx'

function manualDriver(): { driver: FrameDriver; pump: () => void } {
  let callback: (() => void) | undefined
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      callback = undefined
    }
  }
  return { driver, pump: () => callback?.() }
}

afterEach(cleanup)

describe('MetronomeScreen', () => {
  it('runs with no score loaded: pressing Start actually produces clicks, with no score anywhere on screen', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    expect(screen.getByRole('status')).toHaveTextContent('Stopped')

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      // Default 4/4 at 100bpm: a click every 600ms. Advancing 700ms crosses
      // the downbeat (0ms) and beat 2 (600ms), not beat 3 (1200ms).
      clock.advance(700)
      manual.pump()
    })

    // Exact flags and count rule out a stub that fires one unconditional
    // click per frame with no grid behind it at all.
    expect(audio.clicks.map((c) => c.accented)).toEqual([true, false])
    expect(screen.getByTestId('metronome-beat-readout')).toHaveTextContent(/Bar 1, beat 2/)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('pressing Stop actually silences it: no further clicks after stopping', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(700)
      manual.pump()
    })
    const clicksWhileRunning = audio.clicks.length
    expect(clicksWhileRunning).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    act(() => {
      clock.advance(2000)
      manual.pump()
    })

    expect(audio.clicks.length).toBe(clicksWhileRunning)
    expect(screen.getByTestId('metronome-beat-readout')).toHaveTextContent('Stopped')
  })

  it('changing the BPM field actually changes the tempo the metronome runs at', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    const bpmInput = screen.getByLabelText('BPM')
    fireEvent.change(bpmInput, { target: { value: '240' } })
    expect(bpmInput).toHaveValue(240)
    fireEvent.blur(bpmInput)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      // A quarter note at 240bpm is 250ms; at the old default of 100bpm it
      // would be 600ms and this window would still show only the downbeat.
      clock.advance(260)
      manual.pump()
    })

    expect(audio.clicks.length).toBeGreaterThanOrEqual(2)
  })

  it('toggling a beat in the accent editor changes what the metronome actually accents', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    // Default 4/4 accents only beat 1. Turn beat 2 on as well.
    fireEvent.click(screen.getByRole('button', { name: /^Beat 2/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      // A quarter note at the default 100bpm is 600ms, so one full 4/4 bar
      // is 2400ms — advancing exactly that crosses all four beats and no more.
      clock.advance(2400)
      manual.pump()
    })

    // Asserting the whole bar (not just the first two clicks) rules out a
    // stub that hardcodes every click accented, or that toggling beat 2
    // silently accents the whole pattern.
    expect(audio.clicks.map((c) => c.accented)).toEqual([true, true, false, false])
  })

  it('renders one beat dot per beat, marking the accented beat and the currently-sounding one', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { container } = render(
      <MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />,
    )

    // Default 4/4: four dots, only the first (beat 1) accented, none active yet.
    const dotsBefore = container.querySelectorAll('.metronome-beats .beat')
    expect(dotsBefore).toHaveLength(4)
    expect(Array.from(dotsBefore).map((el) => el.classList.contains('is-accent'))).toEqual([
      true,
      false,
      false,
      false,
    ])
    expect(Array.from(dotsBefore).some((el) => el.getAttribute('data-state') === 'active')).toBe(
      false,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      // Crosses the downbeat (0ms) and beat 2 (600ms) only, same window as
      // the readout test above, so beat 2 (index 1) is the last one clicked.
      clock.advance(700)
      manual.pump()
    })

    const dotsAfter = container.querySelectorAll('.metronome-beats .beat')
    expect(Array.from(dotsAfter).map((el) => el.getAttribute('data-state'))).toEqual([
      null,
      'active',
      null,
      null,
    ])
  })

  it('wraps each tempo/metre label and control in a .field, inside a .field-row (roadmap UI-01)', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { container } = render(
      <MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />,
    )

    const row = container.querySelector('.field-row')
    expect(row).not.toBeNull()
    const fields = Array.from(row?.children ?? []).filter((el) => el.classList.contains('field'))
    expect(fields).toHaveLength(4)
    for (const field of fields) {
      // Each label sits directly beside its control inside the field, not as
      // bare text floating next to it — the gap comes from `.field`'s token
      // spacing, not manual markup.
      const label = field.querySelector('label')
      const control = field.querySelector('input, select')
      expect(label).not.toBeNull()
      expect(control).not.toBeNull()
    }
  })

  it('rejects an invalid subdivision/tempo combination and leaves the schedule unchanged', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    const bpmInput = screen.getByLabelText('BPM')
    fireEvent.change(bpmInput, { target: { value: '300' } })
    fireEvent.blur(bpmInput)

    const subdivisionSelect = screen.getByLabelText('Subdivision')
    fireEvent.change(subdivisionSelect, { target: { value: '8' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(subdivisionSelect).toHaveValue('1')
  })

  it('clearing the Beats field reports an error instead of throwing', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    const beatsInput = screen.getByLabelText('Beats')
    expect(() => fireEvent.change(beatsInput, { target: { value: '' } })).not.toThrow()

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(beatsInput).toHaveValue(4)
  })
})
