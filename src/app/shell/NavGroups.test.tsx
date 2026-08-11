import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavGroups, type NavGroup, type NavItem } from './NavGroups.tsx'

afterEach(cleanup)

const primary: NavItem = { id: 'today', label: 'Today' }
const groups: readonly NavGroup[] = [
  {
    label: 'Practice',
    items: [
      { id: 'practice', label: 'Practice' },
      { id: 'sight-reading', label: 'Sight reading' },
    ],
  },
  {
    label: 'Learn',
    items: [{ id: 'lessons', label: 'Lessons' }],
  },
  {
    label: 'Drills',
    items: [
      { id: 'flashcards', label: 'Flashcards' },
      { id: 'ear-training', label: 'Ear training' },
      { id: 'rhythm', label: 'Rhythm' },
      { id: 'technique', label: 'Technique' },
      { id: 'theory', label: 'Theory' },
    ],
  },
  {
    label: 'Progress',
    items: [{ id: 'progress', label: 'Progress' }],
  },
]

describe('NavGroups', () => {
  it('renders each group with a group landmark labelled by its own visible title', () => {
    render(
      <NavGroups primary={primary} groups={groups} activeScreen="today" onNavigate={vi.fn()} />,
    )

    const drills = screen.getByRole('group', { name: 'Drills' })
    expect(
      within(drills).getByRole('button', { name: 'Flashcards' }),
    ).toBeInTheDocument()
    expect(within(drills).getByRole('button', { name: 'Ear training' })).toBeInTheDocument()
    expect(within(drills).getByRole('button', { name: 'Rhythm' })).toBeInTheDocument()
    expect(within(drills).getByRole('button', { name: 'Technique' })).toBeInTheDocument()
    expect(within(drills).getByRole('button', { name: 'Theory' })).toBeInTheDocument()

    expect(screen.getByRole('group', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Learn' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Progress' })).toBeInTheDocument()
  })

  it('marks the active screen with aria-current, including the standalone Today button', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="flashcards"
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Flashcards' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: 'Today' })).not.toHaveAttribute('aria-current')
  })

  it('calls onNavigate with the clicked item id, for both the primary button and a grouped one', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <NavGroups primary={primary} groups={groups} activeScreen="today" onNavigate={onNavigate} />,
    )

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(onNavigate).toHaveBeenCalledWith('today')

    await user.click(screen.getByRole('button', { name: 'Theory' }))
    expect(onNavigate).toHaveBeenCalledWith('theory')
  })

  it('puts Today before every group in DOM order, so tab order follows the visual order', () => {
    render(
      <NavGroups primary={primary} groups={groups} activeScreen="today" onNavigate={vi.fn()} />,
    )

    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons[0]).toBe('Today')
    // Practice group's items come before Drills group's items.
    expect(buttons.indexOf('Practice')).toBeLessThan(buttons.indexOf('Flashcards'))
    expect(buttons.indexOf('Flashcards')).toBeLessThan(buttons.indexOf('Progress'))
  })
})
