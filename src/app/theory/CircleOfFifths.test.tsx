/**
 * `CircleOfFifths` reports the real `Key` a wedge names, and its highlighting
 * is driven by `relativeKey`/`closelyRelatedKeys` from core — these tests
 * assert against those same functions rather than hard-coded expectations, so
 * they would fail if the component re-derived the relationships itself and
 * got them wrong.
 */
import {
  closelyRelatedKeys,
  enharmonicKey,
  keyFromFifths,
  keyName,
  relativeKey,
  type Key,
} from '@core/theory/keys.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CircleOfFifths } from './CircleOfFifths.tsx'

afterEach(cleanup)

describe('CircleOfFifths', () => {
  it('reports the G major key when its wedge is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CircleOfFifths onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'G major' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    const selected = onSelect.mock.calls[0]?.[0]
    expect(keyName(selected)).toBe(keyName(keyFromFifths(1, 'major')))
  })

  it('selects the relative minor when its inner wedge is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CircleOfFifths onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'E minor' }))

    const selected = onSelect.mock.calls[0]?.[0]
    expect(keyName(selected)).toBe(keyName(relativeKey(keyFromFifths(1, 'major'))))
  })

  it('supports keyboard activation with Enter, reporting the focused wedge, not always C major', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CircleOfFifths onSelect={onSelect} />)

    const wedge = screen.getByRole('button', { name: 'G major' })
    wedge.focus()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(keyName(onSelect.mock.calls[0]?.[0])).toBe(keyName(keyFromFifths(1, 'major')))
  })

  it('supports keyboard activation with Space, reporting the focused wedge', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CircleOfFifths onSelect={onSelect} />)

    const wedge = screen.getByRole('button', { name: 'D major' })
    wedge.focus()
    await user.keyboard(' ')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(keyName(onSelect.mock.calls[0]?.[0])).toBe(keyName(keyFromFifths(2, 'major')))
  })

  it('highlights the selected key, its relative, and its closely-related neighbours', () => {
    const gMajor = keyFromFifths(1, 'major')
    render(<CircleOfFifths selected={gMajor} onSelect={() => {}} />)

    expect(screen.getByTestId('circle-key-major-1')).toHaveAttribute('data-highlight', 'selected')

    const relative = relativeKey(gMajor)
    expect(
      screen.getByTestId(`circle-key-${relative.mode}-${relative.signature.fifths}`),
    ).toHaveAttribute('data-highlight', 'relative')

    for (const related of closelyRelatedKeys(gMajor)) {
      const el = screen.getByTestId(`circle-key-${related.mode}-${related.signature.fifths}`)
      // A related key that also happens to be the relative is already asserted above.
      expect(['relative', 'related']).toContain(el.getAttribute('data-highlight'))
    }

    // Db major (fifths -5) is unrelated to G major and must not be highlighted.
    expect(screen.getByTestId('circle-key-major--5')).toHaveAttribute('data-highlight', 'none')
  })

  it('highlights an off-rim neighbour via its drawn enharmonic twin', () => {
    // Db major (-5) sits at the rim; its subdominant Gb major (-6) and Gb's
    // relative Eb minor (-6) have no station of their own — only their
    // enharmonic twins F# major/D# minor (+6) are drawn (see the finding on
    // `highlightFor` not wrapping round the rim).
    const dbMajor = keyFromFifths(-5, 'major')
    render(<CircleOfFifths selected={dbMajor} onSelect={() => {}} />)

    for (const related of closelyRelatedKeys(dbMajor)) {
      // Whichever spelling actually has a drawn station (-5..+6) is the one to check —
      // a related key can be drawn directly, or only via its enharmonic twin.
      const drawable = [related, enharmonicKey(related)].find(
        (k): k is Key => k !== null && k !== undefined && k.signature.fifths >= -5 && k.signature.fifths <= 6,
      )
      expect(drawable).toBeDefined()
      const el = screen.getByTestId(`circle-key-${drawable?.mode}-${drawable?.signature.fifths}`)
      expect(['relative', 'related']).toContain(el.getAttribute('data-highlight'))
    }
  })

  it('renders all twelve major and twelve minor wedges as focusable buttons', () => {
    render(<CircleOfFifths onSelect={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(24)
    for (const button of buttons) {
      expect(button).toHaveAttribute('tabindex', '0')
    }
  })
})
