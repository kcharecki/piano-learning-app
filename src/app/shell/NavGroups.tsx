/**
 * Groups the shell's 12 flat nav buttons into the structure the app already
 * has (roadmap 5.43): Today stands alone as the entry point, visually
 * primary; everything else falls into Practice / Learn / Drills / Progress.
 * Before this, a learner could not tell that Flashcards, Ear training,
 * Rhythm, Technique and Theory are all drills, or that Today is where a
 * session starts.
 *
 * Roadmap UI-04a (2026-08-12 UI audit) added two more things every item
 * needed: a 16px `<Icon>` next to its label (the rail carried plain text
 * only, no glyph to scan by), and a rail footer under every group showing
 * the current playing level and streak — the one piece of learner context
 * the whole nav previously had zero of. Both are still purely presentational:
 * `Shell.tsx` supplies the icon per `NavItem` and the two footer numbers
 * (read from `useLevelStore`/`useProgressStore`, no logic here or there).
 *
 * Purely presentational: `Shell.tsx` owns `NAV_ITEMS`, the active screen and
 * the click handler; this component only lays them out. Each group is
 * `role="group"` with an `aria-labelledby` pointing at its own visible
 * title (rather than a duplicate `aria-label` string) so the accessible
 * name and the on-screen heading can never drift apart. `<nav aria-label
 * ="Main">` (the actual landmark) stays in `Shell.tsx`, wrapping this.
 *
 * Tab order follows visual order because it IS DOM order — Today's button,
 * then each group in the order it's declared, then the rail footer: the
 * level/streak line is not focusable (plain text), but the `actions` prop
 * (roadmap UI-36 — the shell's action cluster, desktop only) that precedes
 * it in `.nav-rail-footer` is. No CSS `order` is involved anywhere in this.
 */
import { Icon, type IconProps } from '@app/ui/Icon.tsx'
import type { ReactNode } from 'react'
import type { ScreenId } from './route.ts'

export type NavItem = {
  readonly id: ScreenId
  readonly label: string
  /** 16px in the rail (roadmap UI-04a) — see `Icon.tsx` for the full name list. */
  readonly icon: IconProps['name']
}

export type NavGroup = {
  readonly label: string
  readonly items: readonly NavItem[]
}

/**
 * The rail footer's two numbers (roadmap UI-04a) — display only. `Shell.tsx`
 * reads `level` off `useLevelStore`'s `playing` track and `streakDays` via
 * `@core/progress/log.ts`'s `currentStreakDays` over `useProgressStore`'s
 * practice log, the same function `useDashboard.ts` already calls for the
 * dashboard's own streak line. Neither number is computed here.
 */
export type NavFooter = {
  readonly level: number
  readonly streakDays: number
}

export type NavGroupsProps = {
  /** Today — rendered before every group, styled as the primary destination. */
  readonly primary: NavItem
  readonly groups: readonly NavGroup[]
  readonly activeScreen: ScreenId
  readonly onNavigate: (id: ScreenId) => void
  readonly footer: NavFooter
  /**
   * Roadmap UI-36: the shell's action cluster (input-status chip +
   * Reference toggle) — `undefined` at <=1024px, where `Shell.tsx` renders
   * that same cluster in the topbar instead. Rendered above the level/streak
   * line inside `.nav-rail-footer`, never inside `.nav-scroll` — the footer
   * is deliberately the ONE part of the rail that never scrolls out of
   * reach, which the action cluster (an interactive control, unlike the
   * scroll box's nav buttons) needs just as much as the footer's own
   * display-only text does.
   */
  readonly actions?: ReactNode | undefined
}

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function NavGroups({
  primary,
  groups,
  activeScreen,
  onNavigate,
  footer,
  actions,
}: NavGroupsProps) {
  return (
    <>
      {/* Roadmap UI-36: the rail's ONLY scroll box — everything that can grow
          past the viewport's height (Today + every group) lives inside it;
          `.nav-rail-footer` below is a flex sibling, never a scrolled child,
          so the action cluster and the level/streak line stay reachable
          without scrolling regardless of how many destinations are above
          them (feature-nav-groups.css's `.nav-scroll`/`min-height: 0` pair
          is what makes this box — not `.app-nav` itself — the one that
          actually shrinks and scrolls). */}
      <div className="nav-scroll">
        <button
          type="button"
          className="nav-primary"
          aria-current={activeScreen === primary.id ? 'page' : undefined}
          onClick={() => onNavigate(primary.id)}
        >
          <Icon name={primary.icon} size={16} />
          {primary.label}
        </button>

        {groups.map((group) => {
          const titleId = `nav-group-${slugOf(group.label)}`
          return (
            <div key={group.label} role="group" aria-labelledby={titleId} className="nav-group">
              <p id={titleId} className="nav-group-title">
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={activeScreen === item.id ? 'page' : undefined}
                      onClick={() => onNavigate(item.id)}
                    >
                      <Icon name={item.icon} size={16} />
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Roadmap UI-36: pinned to the bottom of the rail by `.nav-rail-footer`
          itself now (`flex: none` as a sibling of `.nav-scroll`'s `flex: 1 1
          auto`, feature-nav-groups.css) — UI-04a's `margin-top: auto` and
          `border-top` used to live on `.nav-footer` directly, doing that same
          pinning inside `.app-nav`'s own flex column; both moved up to this
          wrapper once it, not `.nav-footer`, became the last child of that
          column. `actions` is `undefined` at <=1024px (see this prop's own
          doc), so nothing renders above `.nav-footer` at that width; the line
          below is unconditional at every width. `"N-day streak"` is the
          adjectival form (never "N day(s)") so it never needs a plural
          branch — rule 7 (learner language) forbids "0 day(s)". A fresh
          profile has no streak at all yet, and "0-day streak" is itself a
          zero-row (DESIGN.md rule 6) — "No streak yet" until `streakDays`
          is actually positive. */}
      <div className="nav-rail-footer">
        {actions}
        <div className="nav-footer">
          <Icon name="flame" size={16} />
          <span>
            Level {footer.level} · {footer.streakDays > 0 ? `${footer.streakDays}-day streak` : 'No streak yet'}
          </span>
        </div>
      </div>
    </>
  )
}
