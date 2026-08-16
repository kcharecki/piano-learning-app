/**
 * Drums' home screen (roadmap DR-01): the placeholder that makes the
 * instrument switcher drivable before any drum trainer exists. Scope for
 * this task is explicitly the switcher itself — "any drum feature behind the
 * placeholder" is out of scope — so this screen names what is coming rather
 * than offering a control that would do nothing.
 *
 * DESIGN.md rule 6 ("empty states teach... offers the one action that gets
 * them there") normally wants a CTA here; there genuinely is none to offer
 * yet, so this follows rule 1's own precedent instead ("zero is correct...
 * manufacturing one is worse than having none") — the copy explains what is
 * coming instead of manufacturing a button that leads nowhere. Flagged in
 * this task's report as a documented judgement call, not a silent omission.
 */
import { Icon } from '@app/ui/Icon.tsx'

export function DrumsTodayScreen() {
  return (
    <div className="page page--focus drums-today-screen" role="region" aria-label="Drums">
      <div className="page-header">
        <h1>Drums — start here</h1>
        <p className="page-header-subtitle">Your drum practice home, once there is one to show.</p>
      </div>
      <div className="empty-state">
        <Icon name="rhythm" />
        <p>
          Drum training is coming soon — practice plans, rhythm trainers and grooves tailored to
          your level will appear here.
        </p>
      </div>
    </div>
  )
}
