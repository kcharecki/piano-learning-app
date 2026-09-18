/**
 * Drums' home screen (roadmap DR-01/DR-09/DR-10/DR-11/DR-12).
 *
 * DR-01 shipped this as a placeholder with no call to action, on the argument
 * that DESIGN.md rule 6 ("empty states... offer the one action that gets them
 * there") cannot be honoured when there genuinely is no destination — rule 1's
 * "manufacturing one is worse than having none". DR-09 gave drums its first
 * real destination, and the empty state offered the groove trainer as the one
 * thing a learner on this screen could do.
 *
 * DR-10/DR-11/DR-12 each added another trainer (rudiments, rhythm reading,
 * metronome), so "the one thing" is no longer true: this is now a hub with
 * four destinations, one card each, every card reading its own status back
 * from that trainer's store.
 *
 * Still a home screen with no plan of its own. A drums session plan is its
 * own slice; naming the four drills that exist is honest, and inventing a
 * "today's drums session" out of four independent trainers would not be.
 */
import { Icon } from '@app/ui/Icon.tsx'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'

export type DrumsTrainerId =
  | 'drums-groove'
  | 'drums-reading'
  | 'drums-rudiments'
  | 'drums-metronome'
  | 'drums-coordination'
  | 'drums-progress'

export type DrumsTodayScreenProps = {
  readonly onOpen: (screen: DrumsTrainerId) => void
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function useGrooveStatus(): string {
  const attempts = useDrumsHistoryStore((s) => s.attempts)
  if (attempts.length === 0) return 'No runs yet'
  const last = attempts.reduce((latest, attempt) => (attempt.at > latest.at ? attempt : latest))
  return `${pluralize(attempts.length, 'run')} · last: ${last.grooveTitle} at ${last.bpm} bpm, ${
    last.steady ? 'steady' : 'not steady yet'
  }`
}

function useReadingStatus(): string {
  const level = useDrumsReadingStore((s) => s.level)
  const runs = useDrumsReadingStore((s) => s.runs)
  const runsText = runs.length === 0 ? 'no runs yet' : pluralize(runs.length, 'run')
  return `Level ${level} of 7 · ${runsText}`
}

function useRudimentsStatus(): string {
  const records = useDrumsRudimentStore((s) => s.records)
  const bests = Object.values(records)
  if (bests.length === 0) return 'No personal bests yet'
  const fastest = bests.reduce((max, record) => Math.max(max, record.bestCleanBpm), 0)
  return `Personal bests on ${pluralize(bests.length, 'rudiment')} · fastest ${fastest} bpm`
}

export function DrumsTodayScreen({ onOpen }: DrumsTodayScreenProps) {
  const grooveStatus = useGrooveStatus()
  const readingStatus = useReadingStatus()
  const rudimentsStatus = useRudimentsStatus()

  return (
    <div className="page page--focus drums-today-screen" role="region" aria-label="Drums">
      <div className="page-header">
        <h1>Drums — start here</h1>
        <p className="page-header-subtitle">Your drum practice home.</p>
      </div>
      <div className="drums-today-grid">
        <section className="card drums-today-card">
          <Icon name="rhythm" />
          <h2>Groove trainer</h2>
          <p>Playing a groove on the pads against a click, graded per limb.</p>
          <p className="drums-today-status">{grooveStatus}</p>
          <button type="button" className="btn-primary" onClick={() => onOpen('drums-groove')}>
            Open the groove trainer
          </button>
        </section>

        <section className="card drums-today-card">
          <Icon name="book" />
          <h2>Rhythm reading</h2>
          <p>Sight-reading generated rhythm exercises by tapping.</p>
          <p className="drums-today-status">{readingStatus}</p>
          <button type="button" onClick={() => onOpen('drums-reading')}>
            Open rhythm reading
          </button>
        </section>

        <section className="card drums-today-card">
          <Icon name="hand" />
          <h2>Rudiments</h2>
          <p>The 40 PAS rudiments on a tempo ladder with personal bests.</p>
          <p className="drums-today-status">{rudimentsStatus}</p>
          <button type="button" onClick={() => onOpen('drums-rudiments')}>
            Open rudiments
          </button>
        </section>

        <section className="card drums-today-card">
          <Icon name="metronome" />
          <h2>Metronome</h2>
          <p>Keeping time when the click drops out, mutes at random or speeds up.</p>
          <p className="drums-today-status">
            Subdivisions 1–4, click on 2 &amp; 4, gap bars, random mute, tempo ramp
          </p>
          <button type="button" onClick={() => onOpen('drums-metronome')}>
            Open the metronome
          </button>
        </section>

        <section className="card drums-today-card">
          <Icon name="cards" />
          <h2>Coordination</h2>
          <p>Building a groove one limb at a time, and moving the kick through every sixteenth.</p>
          <p className="drums-today-status">Layer build · kick permutations</p>
          <button type="button" onClick={() => onOpen('drums-coordination')}>
            Open coordination
          </button>
        </section>

        <section className="card drums-today-card">
          <Icon name="chart" />
          <h2>Progress</h2>
          <p>Rudiment tiers, best steady tempos, limb bias and reading level in one place.</p>
          <p className="drums-today-status">Read-only summary of every trainer</p>
          <button type="button" onClick={() => onOpen('drums-progress')}>
            Open progress
          </button>
        </section>
      </div>
    </div>
  )
}
