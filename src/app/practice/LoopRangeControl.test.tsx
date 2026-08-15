import { C_MAJOR_SCALE_RH, TWO_HAND_CHORDS } from '@test/fixtures.ts'
import { measureRange } from '@core/notation/score.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoopRangeControl } from './LoopRangeControl.tsx'

afterEach(cleanup)

describe('LoopRangeControl', () => {
  it('starts unchecked and covering the whole score', () => {
    render(
      <LoopRangeControl
        score={C_MAJOR_SCALE_RH}
        loop={undefined}
        onChange={() => {}}
        tempoScale={1}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Loop' })).not.toBeChecked()
    expect(screen.getByLabelText('From measure')).toHaveValue(1)
    expect(screen.getByLabelText('To measure')).toHaveValue(C_MAJOR_SCALE_RH.measures.length)
  })

  it('checking the box turns the current measure range on', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <LoopRangeControl
        score={C_MAJOR_SCALE_RH}
        loop={undefined}
        onChange={onChange}
        tempoScale={1}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))

    expect(onChange).toHaveBeenCalledWith(
      measureRange(C_MAJOR_SCALE_RH, 0, C_MAJOR_SCALE_RH.measures.length - 1),
    )
  })

  it('unchecking turns the loop off (undefined), remembering the picked range', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <LoopRangeControl
        score={C_MAJOR_SCALE_RH}
        loop={undefined}
        onChange={onChange}
        tempoScale={1}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))
    const active = onChange.mock.calls[0]?.[0]
    rerender(
      <LoopRangeControl
        score={C_MAJOR_SCALE_RH}
        loop={active}
        onChange={onChange}
        tempoScale={1}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('changing the measure fields recomputes the range while active', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <LoopRangeControl
        score={C_MAJOR_SCALE_RH}
        loop={undefined}
        onChange={onChange}
        tempoScale={1}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))
    const active = onChange.mock.calls[0]?.[0]
    rerender(
      <LoopRangeControl
        score={C_MAJOR_SCALE_RH}
        loop={active}
        onChange={onChange}
        tempoScale={1}
      />,
    )

    const endField = screen.getByLabelText('To measure')
    await user.clear(endField)
    await user.type(endField, '1')

    expect(onChange).toHaveBeenLastCalledWith(measureRange(C_MAJOR_SCALE_RH, 0, 0))
  })

  it('reflects a loop set from outside the control (roadmap 2.11, REQ-3.3.5)', () => {
    // TWO_HAND_CHORDS has 4 measures; the defaults (0..3) differ from this
    // external range (1..2), so a mutant that only derives startMeasure and
    // leaves endMeasure at its default (4) cannot pass the `to measure`
    // assertion too.
    const externalLoop = measureRange(TWO_HAND_CHORDS, 1, 2)
    render(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={externalLoop}
        onChange={() => {}}
        tempoScale={1}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Loop' })).toBeChecked()
    expect(screen.getByLabelText('From measure')).toHaveValue(2)
    expect(screen.getByLabelText('To measure')).toHaveValue(3)
  })

  it('loop going back to undefined leaves the numbers where they were', () => {
    const externalLoop = measureRange(TWO_HAND_CHORDS, 1, 2)
    const { rerender } = render(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={externalLoop}
        onChange={() => {}}
        tempoScale={1}
      />,
    )
    expect(screen.getByLabelText('From measure')).toHaveValue(2)

    rerender(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={undefined}
        onChange={() => {}}
        tempoScale={1}
      />,
    )

    // The checkbox reflects `loop` directly and goes off, but the numbers
    // stay at the measures that were just looping — same "remembers where it
    // was" behaviour as unchecking the box itself, now also true for a loop
    // that arrived from outside the control.
    expect(screen.getByRole('checkbox', { name: 'Loop' })).not.toBeChecked()
    expect(screen.getByLabelText('From measure')).toHaveValue(2)
    expect(screen.getByLabelText('To measure')).toHaveValue(3)
  })

  it('editing a number while an externally-set loop is active still emits the right tick range', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // TWO_HAND_CHORDS defaults to (0..3); this external range (0..2) differs
    // from the default endMeasure (3), so the assertion below only holds if
    // endMeasure was actually derived from `loop` rather than defaulted.
    const externalLoop = measureRange(TWO_HAND_CHORDS, 0, 2)
    render(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={externalLoop}
        onChange={onChange}
        tempoScale={1}
      />,
    )

    const startField = screen.getByLabelText('From measure')
    await user.clear(startField)
    await user.type(startField, '1')

    expect(onChange).toHaveBeenLastCalledWith(measureRange(TWO_HAND_CHORDS, 0, 2))
  })

  it('an external loop equal to a previously-emitted range still updates the display', () => {
    // Regression for the stale `lastEmitted` ref: check the box (emits
    // 0..3), simulate an external loop elsewhere (1..2), then set the loop
    // back to the SAME range the control emitted earlier (0..3) via an
    // external setLoop call. Because that range is byte-identical to what
    // `lastEmitted` recorded, the sync effect used to skip it and the boxes
    // kept showing 1..2 forever.
    const wholeScore = measureRange(TWO_HAND_CHORDS, 0, 3)
    const { rerender } = render(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={wholeScore}
        onChange={() => {}}
        tempoScale={1}
      />,
    )
    expect(screen.getByLabelText('From measure')).toHaveValue(1)
    expect(screen.getByLabelText('To measure')).toHaveValue(4)

    const middleRange = measureRange(TWO_HAND_CHORDS, 1, 2)
    rerender(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={middleRange}
        onChange={() => {}}
        tempoScale={1}
      />,
    )
    expect(screen.getByLabelText('From measure')).toHaveValue(2)
    expect(screen.getByLabelText('To measure')).toHaveValue(3)

    rerender(
      <LoopRangeControl
        score={TWO_HAND_CHORDS}
        loop={wholeScore}
        onChange={() => {}}
        tempoScale={1}
      />,
    )
    expect(screen.getByLabelText('From measure')).toHaveValue(1)
    expect(screen.getByLabelText('To measure')).toHaveValue(4)
  })

  // Roadmap 2.29 (REQ-3.9.3): the tempo shown belongs to whatever `tempoScale`
  // the caller passes in — this control never computes it, only displays it —
  // so the coupling between the selected range and its own tempo is visible.
  describe('per-loop tempo display (roadmap 2.29, REQ-3.9.3)', () => {
    it('shows the whole-piece tempo while no loop is active', () => {
      render(
        <LoopRangeControl
          score={C_MAJOR_SCALE_RH}
          loop={undefined}
          onChange={() => {}}
          tempoScale={1}
        />,
      )
      const stat = screen.getByTestId('loop-tempo')
      expect(stat).toHaveTextContent('100%')
      expect(stat).toHaveTextContent('Tempo')
    })

    it('shows the active loop\'s own tempo, and updates when the caller passes a different one', () => {
      const loop = measureRange(C_MAJOR_SCALE_RH, 0, 1)
      const { rerender } = render(
        <LoopRangeControl
          score={C_MAJOR_SCALE_RH}
          loop={loop}
          onChange={() => {}}
          tempoScale={0.6}
        />,
      )
      expect(screen.getByTestId('loop-tempo')).toHaveTextContent('60%')
      expect(screen.getByTestId('loop-tempo')).toHaveTextContent('Loop tempo')

      // Switching to a different loop's own remembered scale (simulating the
      // parent re-rendering after `scoreStore.setLoop` restored it) changes
      // only the displayed number, not the range fields' own sync logic.
      rerender(
        <LoopRangeControl
          score={C_MAJOR_SCALE_RH}
          loop={loop}
          onChange={() => {}}
          tempoScale={0.9}
        />,
      )
      expect(screen.getByTestId('loop-tempo')).toHaveTextContent('90%')
      expect(screen.getByTestId('loop-tempo')).toHaveTextContent('Loop tempo')
    })
  })
})
