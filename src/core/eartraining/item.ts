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
import type { Key } from '@core/theory/keys.ts'

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
   *
   * Kept exactly as roadmap 5.28 shipped it (the item's own structural root
   * — chord root, interval's lower note, scale tonic, dictation's key tonic)
   * because `RevealPanel.tsx` reads it to highlight the ANSWER's own root
   * after grading, which is a different job from establishing a tonal
   * context BEFORE the item plays (see `contextKey` below, roadmap 5.55) —
   * conflating the two would either leak part of the answer through the
   * pre-answer drone or mis-highlight the post-answer reveal.
   */
  readonly contextTonicMidi?: Midi
  /**
   * The real key (tonic + mode) whose tonic TRIAD is sounded as tonal
   * context before this item plays (roadmap 5.55) — undefined whenever there
   * is no real tonal center to establish, OR establishing one would leak or
   * distract from the answer. Only `interval-*` and `melodic-dictation` ever
   * set this:
   *
   *  - `melodic-dictation` sets its own REAL generation key (its answer is
   *    the notes/rhythm, never major-vs-minor, so the genuine mode teaches
   *    nothing false).
   *  - `interval-*` draws a key whose MODE carries no information about the
   *    drawn interval's SIZE (the actual answer), but whose lower sounding
   *    note is drawn as a diatonic degree OF that key — so the announced key
   *    and the material are coherent, the way a real key and a real melodic
   *    fragment always are, rather than two unrelated draws (review finding
   *    F2: the original "fully independent key" design left the announced
   *    key diatonic to the sounding interval only 30.1% of the time).
   *  - `chord-quality` and `scale-mode` never set this (review finding F2b):
   *    their own level-1 answer sets ARE a major/minor-style pair ({major,
   *    minor}, {major, naturalMinor}), so any tonic triad either leaks the
   *    answer (matches the drawn quality/type) or actively misleads (does
   *    not) — there is no key to establish that is not itself part of the
   *    question. Quality/mode identification is context-free by design in
   *    every syllabus this app cites.
   *  - `rhythmic-dictation` never sets this: rhythm has no scale.
   *
   * Distinct from `contextTonicMidi` (see that field's own doc) so
   * `RevealPanel.tsx`'s unrelated post-answer use is never disturbed.
   */
  readonly contextKey?: Key
}

/** The result of grading one answer. Drills that grade note-by-note extend this. */
export type EarGrade = {
  readonly correct: boolean
  /** The canonical answer, for showing after a wrong attempt. */
  readonly expected: string
  /** What the learner actually answered, canonicalised the same way. */
  readonly given: string
}
