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
 * then each group in the order it's declared, then the footer (not
 * focusable — plain text), with no CSS `order` involved.
 */
import { Icon, type IconProps } from '@app/ui/Icon.tsx'
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
}

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function NavGroups({ primary, groups, activeScreen, onNavigate, footer }: NavGroupsProps) {
  return (
    <>
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

      {/* Roadmap UI-04a: pinned to the bottom of the rail via `.app-nav`'s
          flex column (`feature-nav-groups.css`) — `margin-top: auto` on
          `.nav-footer` does the pinning, nothing here. `"N-day streak"` is
          the adjectival form (never "N day(s)") so it never needs a plural
          branch — rule 7 (learner language) forbids "0 day(s)". */}
      <div className="nav-footer">
        <Icon name="flame" size={16} />
        <span>
          Level {footer.level} · {footer.streakDays}-day streak
        </span>
      </div>
    </>
  )
}
