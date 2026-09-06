/**
 * DR-05's development gallery — every reference groove drawn through the same
 * `GrooveStaff` the trainer uses. Reached only by URL (`/drums/notation-dev`,
 * see `route.ts`); deliberately absent from the drums nav, so a learner never
 * lands here.
 *
 * It exists because the trainer can only ever show the grooves the trainer
 * offers, and the renderer has to be checkable against content the trainer
 * deliberately withholds. `ghostFunkBar` is the case in point: the trainer
 * refuses to offer it because it cannot sense the velocity that groove is
 * made of (`practice/library.ts` says so at length), but the *renderer* must
 * still draw its ghosts and accents correctly, and this is the only surface
 * where that can be seen.
 *
 * Every groove here comes from `referenceGrooves.ts` — nothing is authored
 * locally, so the gallery cannot drift into showing a shape the rest of the
 * app has never heard of.
 */
import { useMemo } from 'react'
import { DrumKey } from '@app/drums/notation/DrumKey.tsx'
import { GrooveStaff } from '@app/drums/notation/GrooveStaff.tsx'
import { GROOVE_PAD_LABEL } from '@app/drums/groove/padLabels.ts'
import { describeGroove } from '@core/drums/engrave/describe.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import { referenceGrooves } from '@core/drums/model/referenceGrooves.ts'

// No pad is bound to a key on this developer-only screen — there is nothing
// here for a learner to press, so `DrumKey` gets a `keyFor` that always
// answers "no key" rather than a real binding table that would be a lie.
function noKeyBound(): undefined {
  return undefined
}

function GalleryItem({ score }: { readonly score: GrooveScore }) {
  const layout = useMemo(() => engraveGroove(score), [score])
  const label = useMemo(() => describeGroove(score, (pad) => GROOVE_PAD_LABEL[pad]), [score])
  return (
    <section className="card notation-gallery-item">
      <h2>{score.title}</h2>
      <GrooveStaff layout={layout} label={label} grooveId={score.id} />
      <DrumKey layout={layout} labelFor={(pad) => GROOVE_PAD_LABEL[pad]} keyFor={noKeyBound} />
      <p className="notation-gallery-caption">{label}</p>
    </section>
  )
}

export function NotationDevGallery() {
  const grooves = useMemo(() => referenceGrooves(), [])
  return (
    <div className="page screen notation-gallery">
      <div className="page-header">
        <h1>Notation dev gallery</h1>
        <p className="page-header-subtitle">
          Every reference groove through the trainer&apos;s own renderer. The caption under each
          staff is the figure&apos;s accessible name, printed so it can be read against the
          picture.
        </p>
      </div>
      {grooves.map((score) => (
        <GalleryItem key={score.id} score={score} />
      ))}
    </div>
  )
}
