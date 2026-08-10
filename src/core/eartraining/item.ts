/**
 * The shape every ear-training drill shares (REQ-3.6.x). Written as a contract
 * before the drills that implement it, so interval, chord and dictation items
 * can be held in one list, played by one player and graded by one screen.
 *
 * A prompt is a `Score`, not a bespoke note list, and that is the whole point:
 * the transport, the audio output, the hand filter and the engraver already
 * take a `Score`, so an ear-training item plays — and, for dictation, can be
 * revealed — through code that already exists and is already tested.
 */
import type { Score } from '@core/notation/score.ts'
import type { Midi } from '@core/shared/units.ts'

/** Which drill produced an item. Also the SRS card-id namespace, so keep them stable. */
export type EarItemKind =
  | 'interval-melodic'
  | 'interval-harmonic'
  | 'chord-quality'
  | 'scale-mode'
  | 'melodic-dictation'
  | 'rhythmic-dictation'

/**
 * One thing the learner hears and answers. `answerKey` is the canonical
 * answer in each drill's own vocabulary — the drill that made the item is the
 * only thing that interprets it, which is why it is a `string` here and a
 * parsed type there (e.g. `M3`, `dim7`, `dorian`).
 */
export type EarItem = {
  /** Stable and derived from the content, so SRS scheduling survives a reload. */
  readonly id: string
  readonly kind: EarItemKind
  /** What is played. Never shown before the answer for a listening drill. */
  readonly prompt: Score
  readonly answerKey: string
  /** 1-based; what `adaptLevel` moves up and down. */
  readonly level: number
  /**
   * The tonic to sound as a brief context (roadmap 5.28) before this item
   * plays — undefined when the drill has no real tonal center to establish.
   * `rhythmic-dictation` never sets this: rhythm has no scale (see
   * `dictation.ts`'s own note on `opts.key` there), so a tonic before it
   * would be noise, not context. App-level scheduling (`useEarTraining.ts`)
   * reads this to play the context through `AudioOutput`; core never touches
   * audio output itself.
   */
  readonly contextTonicMidi?: Midi
}

/** The result of grading one answer. Drills that grade note-by-note extend this. */
export type EarGrade = {
  readonly correct: boolean
  /** The canonical answer, for showing after a wrong attempt. */
  readonly expected: string
  /** What the learner actually answered, canonicalised the same way. */
  readonly given: string
}
