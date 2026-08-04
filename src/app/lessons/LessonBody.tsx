/**
 * Renders one lesson's `explanation` (roadmap 4.9b, REQ-3.1.3). There is no
 * markdown dependency in this project, so this supports exactly the small
 * subset the authored content in `src/content/curriculum/lessonsLevel*.ts`
 * actually uses — checked directly against those files, not guessed:
 *  - paragraphs, separated by a blank line;
 *  - a `[diagram:<id>]` reference, alone on its own line, which renders the
 *    real `KeyboardDiagram` for that `@content/curriculum/diagrams.ts` entry.
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
import { lessonDiagramById } from '@content/curriculum/diagrams.ts'
import { midi } from '@core/shared/units.ts'
import type { JSX } from 'react'

export type LessonBodyProps = { readonly explanation: string }

/** A whole line, and nothing else, naming a diagram id. */
const DIAGRAM_LINE = /^\[diagram:([A-Za-z0-9-]+)\]$/

function DiagramReference({ id }: { readonly id: string }) {
  const diagram = lessonDiagramById(id)
  if (diagram === undefined) {
    return (
      <p role="status" data-testid="lesson-body-unknown-diagram">
        Unknown diagram: {id}
      </p>
    )
  }
  return (
    <figure className="lesson-body-diagram">
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
