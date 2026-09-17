/**
 * The rudiment library (roadmap DR-10): all 40 PAS rudiments, grouped by the
 * Wooton/Vic Firth tier `@content/drums/rudiments.ts` authors them in, each
 * row naming the rudiment, its PAS family, its sticking at a glance, and the
 * learner's own personal record.
 *
 * Presentational only — `records` and the selection live on the screen
 * (`RudimentTrainerScreen.tsx`), which reads `useDrumsRudimentStore` and owns
 * the selected id; this component composes core's own grouping
 * (`rudimentsInTier`) with the trainer's sticking preview (`./rudimentRun.ts`)
 * and does no music logic of its own.
 */
import type { RudimentRecord } from '@app/state/drumsRudimentStore.ts'
import { rudimentsInTier } from '@content/drums/rudiments.ts'
import type { Rudiment, RudimentTier } from '@core/drums/rudiment/index.ts'
import { stickingPreview } from './rudimentRun.ts'

export type RudimentLibraryProps = {
  readonly selectedId: string
  readonly records: Readonly<Record<string, RudimentRecord>>
  readonly onSelect: (id: string) => void
}

const TIERS: readonly RudimentTier[] = [1, 2, 3, 4]

/** Tiers 3-4 are the Wooton progression's "advanced" half — see the module doc. */
function isAdvancedTier(tier: RudimentTier): boolean {
  return tier >= 3
}

function prText(record: RudimentRecord | undefined): string {
  return record === undefined ? '—' : `PR ${record.bestCleanBpm} bpm`
}

export function RudimentLibrary({ selectedId, records, onSelect }: RudimentLibraryProps) {
  return (
    <div className="card rudiment-library">
      {TIERS.map((tier) => (
        <section key={tier} className="rudiment-tier" aria-label={`Tier ${tier}`}>
          <h2 className="rudiment-tier-heading">
            Tier {tier}
            {isAdvancedTier(tier) ? ' — advanced' : ''}
          </h2>
          <ul className="rudiment-tier-list">
            {rudimentsInTier(tier).map((rudiment) => (
              <RudimentRow
                key={rudiment.id}
                rudiment={rudiment}
                selected={rudiment.id === selectedId}
                record={records[rudiment.id]}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

type RudimentRowProps = {
  readonly rudiment: Rudiment
  readonly selected: boolean
  readonly record: RudimentRecord | undefined
  readonly onSelect: (id: string) => void
}

function RudimentRow({ rudiment, selected, record, onSelect }: RudimentRowProps) {
  return (
    <li className="rudiment-row-item">
      <button
        type="button"
        className="rudiment-row"
        aria-label={`Practise ${rudiment.name}`}
        aria-current={selected ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        onClick={() => onSelect(rudiment.id)}
      >
        <span className="rudiment-row-name">{rudiment.name}</span>
        <span className="rudiment-row-family">{rudiment.family}</span>
        <span className="rudiment-row-sticking">{stickingPreview(rudiment)}</span>
        <span className="rudiment-row-pr">{prText(record)}</span>
      </button>
    </li>
  )
}
