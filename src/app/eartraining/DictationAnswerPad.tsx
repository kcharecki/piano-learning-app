/**
 * Answer pad for the two dictation drills (roadmap 3.11, REQ-3.6.1/REQ-3.6.2):
 * the same on-screen keyboard every other keyboard-answered drill uses
 * (`OnScreenKeyboard.tsx` — a real MIDI keyboard funnels into the same
 * `onPress` one layer up, in `useEarTraining.ts`'s `pressDictationNote`),
 * plus Clear/Submit controls and a running count of what has been recorded.
 *
 * This pad only captures the answer. Grading (`gradeDictation`) and the
 * per-note correct/wrong-pitch/wrong-rhythm/missing/extra breakdown are not
 * its job — `EarTrainingScreen` renders that from the hook's `grade` once
 * `onSubmit` has fired, the same way it already renders every other kind's
 * feedback.
 */
import { OnScreenKeyboard } from '@app/drills/OnScreenKeyboard.tsx'
import { QwertyHint } from '@app/keyboardInput/QwertyHint.tsx'
import { defaultBaseNote } from '@app/keyboardInput/qwertyNoteMap.ts'
import { useQwertyNoteInput } from '@app/keyboardInput/useQwertyNoteInput.ts'
import type { DictationAnswerNote } from '@core/eartraining/dictation.ts'
import type { Midi } from '@core/shared/units.ts'
import type { JSX } from 'react'

export type DictationAnswerPadProps = {
  readonly notes: readonly DictationAnswerNote[]
  readonly onPress: (note: Midi) => void
  readonly onClear: () => void
  readonly onSubmit: () => void
  readonly low: Midi
  readonly high: Midi
}

export function DictationAnswerPad({
  notes,
  onPress,
  onClear,
  onSubmit,
  low,
  high,
}: DictationAnswerPadProps): JSX.Element {
  useQwertyNoteInput({
    enabled: true,
    low,
    high,
    baseNote: defaultBaseNote(low, high),
    onPress,
  })

  return (
    <div className="dictation-answer-pad">
      <p data-testid="dictation-note-count" aria-live="polite">
        {notes.length} note{notes.length === 1 ? '' : 's'} recorded
      </p>
      <OnScreenKeyboard low={low} high={high} onPress={onPress} />
      <QwertyHint />
      <div role="group" aria-label="Dictation controls">
        <button type="button" onClick={onClear} disabled={notes.length === 0}>
          Clear
        </button>
        <button type="button" onClick={onSubmit} disabled={notes.length === 0}>
          Submit
        </button>
      </div>
    </div>
  )
}
