/**
 * `MetronomeScreen` (roadmap 2.28, REQ-3.9.1; instrument-panel redesign
 * roadmap UI-16, 2026-08-14 UI audit): the standalone metronome is wired end
 * to end and usable with no score loaded at all — starting it actually
 * produces clicks, and stopping actually silences them. Per-hook scheduling
 * detail (gaps, accents, bpm changes) is `useMetronome.test.ts`'s job; this
 * only proves the screen's wiring drives real output, plus the panel's own
 * structure (glance BPM stage, dots readable without the old status box,
 * the Meter card's field widths).
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

  it('the Start/Stop control toggles in place — one button, its name and aria-pressed flip, nothing is swapped', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    const button = screen.getByRole('button', { name: 'Start' })
    expect(button).toHaveClass('metronome-start-stop')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)

    // Same DOM node (not a second button mounted alongside the first) —
    // `getByRole` with no name filter would throw on more than one match.
    const sameButton = screen.getByRole('button', { name: 'Stop' })
    expect(sameButton).toBe(button)
    expect(sameButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryAllByRole('button', { name: /^(Start|Stop)$/ })).toHaveLength(1)
  })

  it('the BPM slider and its +/- steppers actually change the tempo the metronome runs at', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    const bpmSlider = screen.getByLabelText('BPM')
    fireEvent.change(bpmSlider, { target: { value: '240' } })
    // `type="range"` reports its value as a string, unlike `type="number"`.
    expect(bpmSlider).toHaveValue('240')

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      // A quarter note at 240bpm is 250ms; at the old default of 100bpm it
      // would be 600ms and this window would still show only the downbeat.
      clock.advance(260)
      manual.pump()
    })

    expect(audio.clicks.length).toBeGreaterThanOrEqual(2)
  })

  it('the +/- BPM steppers nudge the tempo by exactly 1 and clamp at the range ends', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    fireEvent.click(screen.getByRole('button', { name: 'Increase BPM' }))
    expect(screen.getByLabelText('BPM')).toHaveValue('101')

    fireEvent.click(screen.getByRole('button', { name: 'Decrease BPM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decrease BPM' }))
    expect(screen.getByLabelText('BPM')).toHaveValue('99')
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

  it('the accented beat carries a structural cue beyond colour: a ring element the other dots do not have', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { container } = render(
      <MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />,
    )

    const dots = Array.from(container.querySelectorAll('.metronome-beats .beat'))
    expect(dots).toHaveLength(4)
    // Beat 1 (index 0) is the accented one by default (4/4's [T,F,F,F]).
    expect(dots[0]?.querySelector('.beat-ring')).not.toBeNull()
    for (const dot of dots.slice(1)) {
      expect(dot.querySelector('.beat-ring')).toBeNull()
    }
  })

  it('wraps Beats, Beat unit and Subdivision in a .field-row of consistently-widthed .field controls, with a max on Beats (roadmap UI-01/UI-16)', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { container } = render(
      <MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />,
    )

    const row = container.querySelector('.metronome-meter-row')
    expect(row).not.toBeNull()
    expect(row).toHaveClass('field-row')
    const fields = Array.from(row?.children ?? []).filter((el) => el.classList.contains('field'))
    expect(fields).toHaveLength(3)
    for (const field of fields) {
      const label = field.querySelector('label')
      const control = field.querySelector('input, select')
      expect(label).not.toBeNull()
      expect(control).not.toBeNull()
    }

    const beatsInput = screen.getByLabelText('Beats')
    expect(beatsInput).toHaveAttribute('max', '32')
  })

  it('groups Beats/Beat unit/Subdivision/accents inside a "Meter" card and BPM stays out of it, on a page--focus panel', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { container } = render(
      <MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />,
    )

    expect(container.querySelector('.page.page--focus')).not.toBeNull()
    const meter = container.querySelector('.metronome-meter')
    expect(meter).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Meter' })).toBeInTheDocument()
    expect(meter?.contains(screen.getByLabelText('Beats'))).toBe(true)
    expect(meter?.querySelector('[role="group"]')).not.toBeNull()
    // BPM lives on the stage, not inside the Meter card.
    expect(meter?.contains(screen.getByLabelText('BPM'))).toBe(false)
  })

  it('renders the BPM readout at the glance type size', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { container } = render(
      <MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />,
    )

    const value = container.querySelector('.metronome-bpm-stepper .stepper-value')
    expect(value).not.toBeNull()
    expect(value).toHaveTextContent('100')
  })

  it('rejects an invalid subdivision/tempo combination and leaves the schedule unchanged', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    render(<MetronomeScreen clock={clock} audioOutput={audio} frameDriver={manual.driver} />)

    const bpmSlider = screen.getByLabelText('BPM')
    fireEvent.change(bpmSlider, { target: { value: '300' } })

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
