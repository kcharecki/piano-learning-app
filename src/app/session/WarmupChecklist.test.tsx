/**
 * `WarmupChecklist` (roadmap 5.45): every step renders, checking one alone
 * does not report "all checked", and checking every step does — the signal
 * `SessionPlanScreen` gates the warm-up's "Complete" action on.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WARMUP_STEPS } from '@content/curriculum/warmups.ts'
import { WarmupChecklist } from './WarmupChecklist.tsx'

afterEach(cleanup)

describe('WarmupChecklist', () => {
  it('renders every WARMUP_STEPS instruction as a checkbox', () => {
    render(<WarmupChecklist onAllCheckedChange={() => {}} />)
    for (const step of WARMUP_STEPS) {
      expect(screen.getByRole('checkbox', { name: step.instruction })).toBeInTheDocument()
    }
  })

  it('reports allChecked=false until every step is checked, then true', () => {
    const onAllCheckedChange = vi.fn()
    render(<WarmupChecklist onAllCheckedChange={onAllCheckedChange} />)

    const boxes = WARMUP_STEPS.map((step) =>
      screen.getByRole('checkbox', { name: step.instruction }),
    )

    for (let i = 0; i < boxes.length - 1; i++) {
      act(() => {
        boxes[i]?.click()
      })
    }
    expect(onAllCheckedChange).toHaveBeenLastCalledWith(false)

    act(() => {
      boxes[boxes.length - 1]?.click()
    })
    expect(onAllCheckedChange).toHaveBeenLastCalledWith(true)
  })

  it('unchecking a step after all-checked reports false again', () => {
    const onAllCheckedChange = vi.fn()
    render(<WarmupChecklist onAllCheckedChange={onAllCheckedChange} />)
    const boxes = WARMUP_STEPS.map((step) =>
      screen.getByRole('checkbox', { name: step.instruction }),
    )
    for (const box of boxes) act(() => box.click())
    expect(onAllCheckedChange).toHaveBeenLastCalledWith(true)

    act(() => {
      boxes[0]?.click()
    })
    expect(onAllCheckedChange).toHaveBeenLastCalledWith(false)
  })
})
