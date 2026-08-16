import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavGroups, type NavGroup, type NavItem } from './NavGroups.tsx'

afterEach(cleanup)

const primary: NavItem = { id: 'today', label: 'Today', icon: 'target' }
const groups: readonly NavGroup[] = [
  {
    label: 'Practice',
    items: [
      { id: 'practice', label: 'Practice', icon: 'keyboard' },
      { id: 'sight-reading', label: 'Sight reading', icon: 'book' },
    ],
  },
  {
    label: 'Learn',
    items: [{ id: 'lessons', label: 'Lessons', icon: 'book' }],
  },
  {
    label: 'Drills',
    items: [
      { id: 'flashcards', label: 'Flashcards', icon: 'cards' },
      { id: 'ear-training', label: 'Ear training', icon: 'ear' },
      { id: 'rhythm', label: 'Rhythm', icon: 'rhythm' },
      { id: 'technique', label: 'Technique', icon: 'hand' },
      { id: 'theory', label: 'Theory', icon: 'book' },
    ],
  },
  {
    label: 'Progress',
    items: [{ id: 'progress', label: 'Progress', icon: 'chart' }],
  },
]
const footer = { level: 1, streakDays: 0 }
// Roadmap DR-01: `switcher` is a required, caller-supplied node — every test
// below stands in a stub rather than the real Shell.tsx switcher, since this
// file's job is NavGroups' own layout/wiring, not the switcher's contents.
const switcherStub = <div data-testid="switcher-stub">switcher</div>

describe('NavGroups', () => {
  it('renders each group with a group landmark labelled by its own visible title', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={footer}
        switcher={switcherStub}
      />,
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
        footer={footer}
        switcher={switcherStub}
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
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={onNavigate}
        footer={footer}
        switcher={switcherStub}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(onNavigate).toHaveBeenCalledWith('today')

    await user.click(screen.getByRole('button', { name: 'Theory' }))
    expect(onNavigate).toHaveBeenCalledWith('theory')
  })

  it('puts Today before every group in DOM order, so tab order follows the visual order', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={footer}
        switcher={switcherStub}
      />,
    )

    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons[0]).toBe('Today')
    // Practice group's items come before Drills group's items.
    expect(buttons.indexOf('Practice')).toBeLessThan(buttons.indexOf('Flashcards'))
    expect(buttons.indexOf('Flashcards')).toBeLessThan(buttons.indexOf('Progress'))
  })

  // Roadmap UI-04a: every item (including the standalone Today button) gets
  // a 16px icon next to its label — icons are always `aria-hidden`
  // (`Icon.tsx`), so the accessible name stays just the label text; this
  // only proves the glyph itself is actually there.
  it('renders a 16px icon in every nav button, primary and grouped alike', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={footer}
        switcher={switcherStub}
      />,
    )

    for (const button of screen.getAllByRole('button')) {
      const icon = button.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('width', '16')
    }
  })

  // Roadmap UI-04a: the rail footer — display only, numbers passed straight
  // through from `footer`. "1-day streak" (not "1 day(s) streak") proves the
  // adjectival form rather than a plural branch.
  it('renders the level and streak footer, pinned after every group', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={{ level: 3, streakDays: 1 }}
        switcher={switcherStub}
      />,
    )

    expect(screen.getByText('Level 3 · 1-day streak')).toBeInTheDocument()
  })

  // UI-21 (states sweep): a fresh profile's `streakDays: 0` used to render
  // the zero-row "0-day streak" — DESIGN.md rule 6 forbids a raw zero, so it
  // reads as "No streak yet" instead, until there is a real streak to name.
  it('shows "No streak yet" rather than a "0-day streak" zero-row', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={{ level: 1, streakDays: 0 }}
        switcher={switcherStub}
      />,
    )

    expect(screen.getByText('Level 1 · No streak yet')).toBeInTheDocument()
    expect(screen.queryByText(/0-day streak/)).not.toBeInTheDocument()
  })

  // Roadmap DR-01: `footer.level` is optional now — Drums has no level
  // concept yet, so Shell.tsx omits the field entirely rather than passing a
  // piano number across an instrument boundary it does not describe. The
  // footer then shows only the streak, with no "Level undefined" leak and no
  // stray "· " separator.
  it('omits the level segment entirely when footer.level is undefined, showing only the streak', () => {
    render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={{ streakDays: 4 }}
        switcher={switcherStub}
      />,
    )

    expect(screen.getByText('4-day streak')).toBeInTheDocument()
    expect(screen.queryByText(/Level/)).not.toBeInTheDocument()
  })

  // Roadmap UI-36: `.nav-scroll` (Today + every group) is the only part of
  // the rail that scrolls; `.nav-rail-footer` (the caller's `actions`, then
  // the level/streak line) never does, so it must sit outside `.nav-scroll`
  // entirely rather than merely after the groups within it.
  it('puts Today and every group inside .nav-scroll, never .nav-rail-footer', () => {
    const { container } = render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={footer}
        switcher={switcherStub}
      />,
    )

    const scroll = container.querySelector('.nav-scroll')
    expect(scroll).not.toBeNull()
    expect(within(scroll as HTMLElement).getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(scroll?.querySelector('.nav-footer')).toBeNull()
  })

  // Roadmap DR-01: the switcher scrolls away WITH the rest of the nav
  // content (see NavGroupsProps.switcher's own doc for why it is not pinned
  // like the rail footer) and comes first, ahead of even the primary button
  // — it names which nav table is currently showing, so it has to be the
  // very first thing a learner scanning the rail sees.
  it('renders the supplied switcher first inside .nav-scroll, ahead of the primary button', () => {
    const { container } = render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={footer}
        switcher={switcherStub}
      />,
    )

    const scroll = container.querySelector('.nav-scroll')
    expect(scroll).not.toBeNull()
    const stub = within(scroll as HTMLElement).getByTestId('switcher-stub')
    const primaryButton = within(scroll as HTMLElement).getByRole('button', { name: 'Today' })
    expect(
      stub.compareDocumentPosition(primaryButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // Roadmap UI-36: `actions` is the shell's action cluster (input-status chip
  // + Reference toggle), passed only at desktop widths (Shell.tsx). It must
  // land inside `.nav-rail-footer`, ahead of the level/streak line — the
  // footer's own DOM order is what visually reads as "cluster, then rail
  // furniture" rather than the reverse.
  it('renders a supplied actions node inside .nav-rail-footer, before the level/streak line', () => {
    const { container } = render(
      <NavGroups
        primary={primary}
        groups={groups}
        activeScreen="today"
        onNavigate={vi.fn()}
        footer={{ level: 2, streakDays: 5 }}
        switcher={switcherStub}
        actions={<button type="button">Reference</button>}
      />,
    )

    const railFooter = container.querySelector('.nav-rail-footer')
    expect(railFooter).not.toBeNull()
    const actionsButton = within(railFooter as HTMLElement).getByRole('button', { name: 'Reference' })
    const streakLine = within(railFooter as HTMLElement).getByText('Level 2 · 5-day streak')
    expect(
      actionsButton.compareDocumentPosition(streakLine) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(container.querySelector('.nav-scroll')?.contains(actionsButton)).toBe(false)
  })
})
