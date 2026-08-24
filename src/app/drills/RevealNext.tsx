/**
 * The exit row of a drill reveal (improve-app run 2026-08-24-1).
 *
 * When an answer is wrong, the flashcard drill and the theory drill both hold
 * the missed prompt on screen with the correct answer named against it, and
 * both need one control to dismiss it and move on. Shared rather than written
 * twice because the two screens were, briefly, written twice: the same row
 * came out with a chevron on one screen and without on the other, which is
 * exactly the kind of drift a screenshot catches and a green suite does not.
 *
 * Focus moves here on mount. The answer input the learner was just using has
 * gone inert, so leaving focus inside it would strand a keyboard user on a
 * disabled control with nothing to press; the row takes focus itself
 * (`tabIndex={-1}` keeps it out of the Tab sequence afterwards) so that the
 * next Tab lands on Next.
 */
import { Icon } from '@app/ui/Icon.tsx'
import { useEffect, useRef } from 'react'

export type RevealNextProps = {
  readonly onNext: () => void
}

export function RevealNext({ onNext }: RevealNextProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rowRef.current?.focus()
  }, [])
  return (
    <div ref={rowRef} tabIndex={-1} role="group" aria-label="Answer result" className="drill-reveal">
      <button type="button" className="btn-primary" onClick={onNext}>
        <Icon name="chevron-right" />
        Next
      </button>
    </div>
  )
}
