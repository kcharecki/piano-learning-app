/**
 * Drums' home screen (roadmap DR-01, DR-09).
 *
 * DR-01 shipped this as a placeholder with no call to action, on the argument
 * that DESIGN.md rule 6 ("empty states... offer the one action that gets them
 * there") cannot be honoured when there genuinely is no destination — rule 1's
 * "manufacturing one is worse than having none". DR-09 gave drums a real
 * destination, so that argument expired with it: the empty state now offers
 * the groove trainer, which is the one thing a learner on this screen can
 * actually do.
 *
 * Still a home screen with no plan of its own. A drums session plan is its own
 * slice; naming the one drill that exists is honest, and inventing a "today's
 * drums session" out of a single trainer would not be.
 */
import { Icon } from '@app/ui/Icon.tsx'

export type DrumsTodayScreenProps = {
  readonly onOpenGroove: () => void
}

export function DrumsTodayScreen({ onOpenGroove }: DrumsTodayScreenProps) {
  return (
    <div className="page page--focus drums-today-screen" role="region" aria-label="Drums">
      <div className="page-header">
        <h1>Drums — start here</h1>
        <p className="page-header-subtitle">Your drum practice home.</p>
      </div>
      <div className="empty-state">
        <Icon name="rhythm" />
        <p>
          One drill so far: the groove trainer plays you a click, you play the groove on the pads,
          and it tells you which limb was off. No kit needed — the keyboard works.
        </p>
        <button type="button" className="btn-primary" onClick={onOpenGroove}>
          Open the groove trainer
        </button>
      </div>
    </div>
  )
}
