/**
 * The answer pad for a `'key-signature'` flashcard (roadmap 3.11, REQ-3.5.2):
 * one button per key signature `buildKeySignatureDeck` can ever draw across
 * the full writable range (`CIRCLE_OF_FIFTHS`), each button naming BOTH
 * tonics together — the major key and its relative minor — because that is
 * the only well-posed answer to a bare key signature (see
 * `core/drills/flashcards.ts`'s module comment: a signature alone never
 * disambiguates major from minor, so the card always asks for the pair).
 *
 * Every button is a real `<button>` with a readable label ("G major / E
 * minor"), so this is keyboard-reachable and screen-reader-friendly for
 * free; the pad itself is a labelled `role="group"`.
 */
import type { KeySignatureAnswer, LetterAlter } from '@core/drills/flashcards.ts'
import { CIRCLE_OF_FIFTHS, relativeKey } from '@core/theory/keys.ts'
import type { Alter } from '@core/theory/pitch.ts'

export type KeySignatureAnswerPadProps = {
  readonly onAnswer: (answer: KeySignatureAnswer) => void
}

const ACCIDENTAL_SUFFIX: Record<Alter, string> = {
  [-2]: '\u{1D12B}',
  [-1]: '♭',
  0: '',
  1: '♯',
  2: '\u{1D12A}',
}

function tonicLabel(tonic: LetterAlter): string {
  return `${tonic.letter}${ACCIDENTAL_SUFFIX[tonic.alter]}`
}

/** Every fifths count `buildKeySignatureDeck` can draw, major tonic paired with its relative minor. */
const KEY_SIGNATURE_BUTTONS: readonly KeySignatureAnswer[] = CIRCLE_OF_FIFTHS.map((major) => {
  const minor = relativeKey(major)
  return {
    majorTonic: { letter: major.tonic.letter, alter: major.tonic.alter },
    minorTonic: { letter: minor.tonic.letter, alter: minor.tonic.alter },
  }
})

function label(answer: KeySignatureAnswer): string {
  return `${tonicLabel(answer.majorTonic)} major / ${tonicLabel(answer.minorTonic)} minor`
}

export function KeySignatureAnswerPad({ onAnswer }: KeySignatureAnswerPadProps) {
  return (
    <div className="key-signature-answer-pad answer-pad" role="group" aria-label="Key signature answer">
      {KEY_SIGNATURE_BUTTONS.map((answer) => (
        // `.music-glyph` (roadmap 5.26, `feature-music-font.css`) puts the
        // accidentals in the bundled Bravura font instead of plain body text
        // — the same fix `StaffNote.tsx` already has. Applied to the WHOLE
        // label, not just the accidental substrings: CSS font-family
        // fallback resolves per-glyph, so the plain letters and " major / "
        // " minor" still render in the UI font (Bravura's cmap has no Latin
        // text) while the accidentals render in Bravura, and the label stays
        // ONE text node — splitting it into per-tonic wrapped nodes was tried
        // first and broken the accessible name, because the accessible-name
        // algorithm joins sibling child nodes with a space
        // ("C ♯ major / A ♯ minor", not "C♯ major / A♯ minor").
        <button
          key={tonicLabel(answer.majorTonic)}
          type="button"
          className="music-glyph"
          onClick={() => onAnswer(answer)}
        >
          {label(answer)}
        </button>
      ))}
    </div>
  )
}
