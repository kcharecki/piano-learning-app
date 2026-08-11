/**
 * Groups the shell's 12 flat nav buttons into the structure the app already
 * has (roadmap 5.43): Today stands alone as the entry point, visually
 * primary; everything else falls into Practice / Learn / Drills / Progress.
 * Before this, a learner could not tell that Flashcards, Ear training,
 * Rhythm, Technique and Theory are all drills, or that Today is where a
 * session starts.
 *
 * Purely presentational: `Shell.tsx` owns `NAV_ITEMS`, the active screen and
 * the click handler; this component only lays them out. Each group is
 * `role="group"` with an `aria-labelledby` pointing at its own visible
 * title (rather than a duplicate `aria-label` string) so the accessible
 * name and the on-screen heading can never drift apart. `<nav aria-label
 * ="Main">` (the actual landmark) stays in `Shell.tsx`, wrapping this.
 *
 * Tab order follows visual order because it IS DOM order — Today's button,
 * then each group in the order it's declared, with no CSS `order` involved.
 */
import type { ScreenId } from './route.ts'

export type NavItem = {
  readonly id: ScreenId
  readonly label: string
}

export type NavGroup = {
  readonly label: string
  readonly items: readonly NavItem[]
}

export type NavGroupsProps = {
  /** Today — rendered before every group, styled as the primary destination. */
  readonly primary: NavItem
  readonly groups: readonly NavGroup[]
  readonly activeScreen: ScreenId
  readonly onNavigate: (id: ScreenId) => void
}

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function NavGroups({ primary, groups, activeScreen, onNavigate }: NavGroupsProps) {
  return (
    <>
      <button
        type="button"
        className="nav-primary"
        aria-current={activeScreen === primary.id ? 'page' : undefined}
        onClick={() => onNavigate(primary.id)}
      >
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
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}
