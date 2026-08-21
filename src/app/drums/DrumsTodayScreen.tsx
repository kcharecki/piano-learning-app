/**
 * Drums' home screen (roadmap DR-01): the placeholder that made the
 * instrument switcher drivable before any drum trainer existed. Scope for
 * that original task was explicitly the switcher itself — "any drum feature
 * behind the placeholder" was out of scope — so the screen named what was
 * coming rather than offer a control that would do nothing.
 *
 * **Superseded (DR-09).** The groove trainer now ships
 * (`GrooveScreen.tsx`, routed at `/drums/groove`) and its nav entry
 * ("PRACTICE > Groove") sits in the same viewport as this screen. The old
 * reasoning does not survive that: DESIGN.md rule 6 ("empty states teach...
 * offers the one action that gets them there") lost to rule 1's precedent
 * ("zero is correct... manufacturing one is worse than having none") only
 * because there was nothing to point at — with a real destination, rule 6 is
 * the one that applies, so the copy below names the groove trainer and links
 * straight to it instead of describing a future. That precedent is kept here
 * rather than deleted so the next placeholder-to-real transition has it to
 * reason from.
 *
 * No `Link`-style primitive exists anywhere in this app (nav items are
 * `<button>`s driven by `Shell.tsx`'s own `navigate`, which lives above this
 * screen and is not reachable from here — `useRoute` holds its route in local
 * state, so calling it a second time down here would fork the router rather
 * than drive it). So this is a real `<a>` whose `href` comes from `route.ts`'s
 * `serializeAppRoute`, never a hand-typed path, plus the `onOpenGroove`
 * callback `Shell.tsx` already uses for exactly this shape of in-app jump
 * (`RepertoireScreen`'s `onOpenInPractice`, `SettingsScreen`'s `onGoToToday`).
 *
 * Both halves are load-bearing. Without the callback the anchor would leave
 * the SPA and reload the whole bundle, throwing away shell state on a
 * navigation the learner experiences as staying inside the app. Without the
 * `href` it would stop being a link: no middle-click, no open-in-new-tab, no
 * status-bar destination, and nothing for a screen reader to announce as one.
 * The handler therefore steps aside for any click the browser should own — a
 * modified click, or anything but the primary button.
 */
import { Icon } from '@app/ui/Icon.tsx'
import { serializeAppRoute } from '@app/shell/route.ts'

const GROOVE_HREF = serializeAppRoute({ instrument: 'drums', route: { screen: 'drums-groove' } })

export type DrumsTodayScreenProps = {
  /** Navigates to the groove trainer through the shell's own router. */
  onOpenGroove?: () => void
}

export function DrumsTodayScreen({ onOpenGroove }: DrumsTodayScreenProps = {}) {
  function openGroove(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (onOpenGroove === undefined) return
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpenGroove()
  }

  return (
    <div className="page page--focus drums-today-screen" role="region" aria-label="Drums">
      <div className="page-header">
        <h1>Drums — start here</h1>
        <p className="page-header-subtitle">Your drum practice home.</p>
      </div>
      <div className="empty-state">
        <Icon name="rhythm" />
        <p>
          The groove trainer teaches timing on the pads, one limb at a time.{' '}
          <a href={GROOVE_HREF} onClick={openGroove}>
            Open the groove trainer
          </a>{' '}
          to start.
        </p>
      </div>
    </div>
  )
}
