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
import { ScoreViewer } from '@app/score/ScoreViewer.tsx'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'
import type { Score } from '@core/notation/score.ts'
import { useMemo } from 'react'

export type ExerciseScoreProps = { readonly score: Score }

export function ExerciseScore({ score }: ExerciseScoreProps) {
  const musicXml = useMemo(() => writeMusicXml(score), [score])
  return <ScoreViewer musicXml={musicXml} score={score} />
}
