/**
 * A generated exercise, engraved (roadmap 2.20, REQ-3.4.1/3.4.2).
 *
 * Generated exercises have no MusicXML of their own — they are built as
 * `Score` values by `@core/generator/melody.ts` — so this writes MusicXML back
 * out of the Score and hands it to the same `ScoreViewer` an imported piece
 * uses. Until this existed the trainer showed a TEXT list of note names, which
 * trains no staff decoding and hands the learner the answer in letters, and
 * the 30-second "scan the key, time and patterns" preview showed no key
 * signature, no time signature and no bar lines.
 *
 * The conversion is memoised on the score identity: `ScoreViewer` re-engraves
 * whenever `musicXml` changes, and a fresh string every render would re-engrave
 * every frame of the preview countdown.
 */
import type { EngraverFactory, ScoreChrome } from '@app/score/engraver.ts'
import { ScoreViewer } from '@app/score/ScoreViewer.tsx'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'
import type { Score } from '@core/notation/score.ts'
import { useMemo } from 'react'

export type ExerciseScoreProps = {
  readonly score: Score
  /** Forwarded verbatim to `ScoreViewer`. Absent — every caller until roadmap
   *  3.14 — means the default OSMD engraver, i.e. today's behaviour exactly.
   *  `ScaleStaff` passes a reference-presentation engraver through here. */
  readonly createEngraver?: EngraverFactory
  /** Forwarded verbatim to `ScoreViewer` (roadmap UI-11). Absent — every
   *  caller before the Sight reading redesign, including Rhythm and
   *  Technique, which also render through this component — means
   *  `ScoreViewer`'s own default chrome (title/composer block drawn, default
   *  paper padding), i.e. today's behaviour exactly. Sight reading is the
   *  first caller to pass `{ title: false }`, so its own screen header (which
   *  already names the piece) is not duplicated by the engraving itself. */
  readonly chrome?: ScoreChrome
}

export function ExerciseScore({ score, createEngraver, chrome }: ExerciseScoreProps) {
  const musicXml = useMemo(() => writeMusicXml(score), [score])
  // Spread rather than `createEngraver={createEngraver}`/`chrome={chrome}`:
  // under `exactOptionalPropertyTypes` an explicit `undefined` is not the
  // same as an absent prop, and absent is what has to reach `ScoreViewer` so
  // its own defaults apply for every caller that passes nothing.
  return (
    <ScoreViewer
      musicXml={musicXml}
      score={score}
      {...(createEngraver && { createEngraver })}
      {...(chrome && { chrome })}
    />
  )
}
