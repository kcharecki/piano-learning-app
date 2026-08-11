/**
 * Renders one lesson's `explanation` (roadmap 4.9b/3.25, REQ-3.1.3). There is
 * no markdown dependency in this project, so this supports exactly the small
 * subset the authored content in `src/content/curriculum/lessonsLevel*.ts`
 * actually uses — checked directly against those files, not guessed:
 *  - paragraphs, separated by a blank line;
 *  - a `[diagram:<id>]` reference, alone on its own line, which resolves the
 *    id through `@content/curriculum/diagrams.ts` and renders it.
 *
 * `LessonDiagram` is a `kind`-discriminated union (roadmap 3.25):
 *  - `'keyboard'` renders the real `KeyboardDiagram`, as before.
 *  - `'staff'`/`'rhythm'` render the diagram's `Score` through the exact same
 *    `ExerciseScore` + read-only reference `ScoreEngraver` pipeline
 *    `@app/theory/ScaleStaff.tsx` already drives for the theory reference
 *    screen — no cursor, no title, no tempo mark (see `ScorePresentation` in
 *    `@app/score/osmdEngraver.ts`). Reusing that pipeline, rather than a
 *    third one, is deliberate: before this, the 7 level-1 lessons about
 *    staff notation and rhythm — and 4 more theory lessons across levels
 *    2-3 — were structurally incapable of carrying a diagram at all, because
 *    `KeyboardDiagram` is the only thing a keyboard-only `LessonDiagram`
 *    could ever point at.
 *
 * Anything else is rendered as plain text rather than dropped — a line that
 * merely looks like a diagram reference but doesn't match exactly (extra
 * text around it, wrong brackets) falls through to the paragraph branch, so
 * the literal text stays visible instead of vanishing. An unknown diagram id
 * renders a visible marker for the same reason: a lesson whose reference
 * silently rendered nothing would be indistinguishable from a lesson with no
 * diagram at all, and content rot like that should be loud, not invisible.
 */
import { KeyboardDiagram } from '@app/theory/KeyboardDiagram.tsx'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { createOsmdEngraver } from '@app/score/osmdEngraver.ts'
import { lessonDiagramById, type LessonDiagram } from '@content/curriculum/diagrams.ts'
import { midi } from '@core/shared/units.ts'
import type { JSX } from 'react'

export type LessonBodyProps = { readonly explanation: string }

/** A whole line, and nothing else, naming a diagram id. */
const DIAGRAM_LINE = /^\[diagram:([A-Za-z0-9-]+)\]$/

/**
 * A diagram is READ, not played: no playback cursor, no title, no tempo mark
 * — the exact same `'reference'` presentation `ScaleStaff.tsx` uses for the
 * theory screen's scale staff, applied here to lesson diagrams for the same
 * reason. Module-level so its identity is stable across renders —
 * `ScoreViewer` re-engraves whenever its engraver factory changes.
 */
const createReferenceEngraver = (): ReturnType<typeof createOsmdEngraver> =>
  createOsmdEngraver({ presentation: 'reference' })

function KeyboardDiagramFigure({ diagram }: { readonly diagram: Extract<LessonDiagram, { kind: 'keyboard' }> }) {
  return (
    <figure className="lesson-body-diagram lesson-body-diagram-keyboard">
      <KeyboardDiagram
        low={midi(diagram.low)}
        high={midi(diagram.high)}
        highlightedPitchClasses={new Set(diagram.highlightedPitchClasses)}
        {...(diagram.rootPitchClass === undefined ? {} : { rootPitchClass: diagram.rootPitchClass })}
        ariaLabel={diagram.caption}
      />
      <figcaption>{diagram.caption}</figcaption>
    </figure>
  )
}

/** Shared by `'staff'` and `'rhythm'` — both just carry a `Score` today. */
function ScoreDiagramFigure({
  diagram,
}: {
  readonly diagram: Extract<LessonDiagram, { kind: 'staff' | 'rhythm' }>
}) {
  return (
    <figure className={`lesson-body-diagram lesson-body-diagram-${diagram.kind}`}>
      <div role="img" aria-label={diagram.caption}>
        <ExerciseScore score={diagram.score} createEngraver={createReferenceEngraver} />
      </div>
      <figcaption>{diagram.caption}</figcaption>
    </figure>
  )
}

function DiagramReference({ id }: { readonly id: string }) {
  const diagram = lessonDiagramById(id)
  if (diagram === undefined) {
    return (
      <p role="status" data-testid="lesson-body-unknown-diagram">
        Unknown diagram: {id}
      </p>
    )
  }
  if (diagram.kind === 'keyboard') return <KeyboardDiagramFigure diagram={diagram} />
  return <ScoreDiagramFigure diagram={diagram} />
}

export function LessonBody({ explanation }: LessonBodyProps): JSX.Element {
  // Blocks are separated by one or more blank lines; a block that is only
  // whitespace (a stray leading/trailing blank line) contributes nothing.
  const blocks = explanation.split(/\n\s*\n/).filter((block) => block.trim().length > 0)

  return (
    <div className="lesson-body">
      {blocks.map((block, blockIndex) => (
        <div key={blockIndex} className="lesson-body-block">
          {block.split('\n').map((line, lineIndex) => {
            const match = DIAGRAM_LINE.exec(line.trim())
            const diagramId = match?.[1]
            if (diagramId !== undefined) {
              return <DiagramReference key={lineIndex} id={diagramId} />
            }
            return <p key={lineIndex}>{line}</p>
          })}
        </div>
      ))}
    </div>
  )
}
