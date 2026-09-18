/**
 * "Learn your kit" (roadmap DR-02): the MIDI-learn wizard, mounted on the
 * calibration screen below the preset picker. This is the real fallback for
 * every e-kit the shipped presets (`@core/drums/kitmap/presets.ts`) miss —
 * "Hit your kick... now your snare..." captures the incoming note per pad,
 * one at a time, and hands the finished map to `onSave` (the calibration
 * screen wires that straight to `useDrumsKitMapStore().setLearned`, which
 * also selects the map in the picker).
 *
 * All the sequencing/conflict/undo rules live in the pure
 * `@core/drums/kitmap/learn.ts` state machine; this component is only the
 * thin shell around it — local `wizard` state (`undefined` = idle, a
 * `LearnState` = running), a `useEffect` keyed on `lastNoteOn?.seq` that
 * feeds every incoming note-on to `captureNote` while the wizard is active,
 * and the buttons/labels the contract specifies.
 */
import { useEffect, useState } from 'react'
import {
  LEARN_STEPS,
  LEARNED_KIT_MAP_NAME,
  captureNote,
  currentStep,
  isFinished,
  kitMapFromCaptures,
  requiredStepsDone,
  skipStep,
  startLearn,
  undoStep,
  type LearnCapture,
  type LearnState,
  type LearnTarget,
} from '@core/drums/kitmap/learn.ts'
import type { KitMap } from '@core/drums/kitmap/kitMap.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { DrumMidiInputState } from '@app/drums/input/useDrumMidiInput.ts'

export type KitMapLearnCardProps = {
  readonly lastNoteOn: DrumMidiInputState['lastNoteOn']
  readonly connected: boolean
  readonly onSave: (map: KitMap) => void
}

/** Short learner-facing name for each pad — the capture list ("Kick — note 36") and the conflict line both read off this. */
const PAD_LABEL: Readonly<Record<MappedDrumPad, string>> = {
  kick: 'Kick',
  hhPedal: 'Hi-hat pedal',
  tomFloor: 'Floor tom',
  tomMid: 'Mid tom',
  snare: 'Snare',
  snareRim: 'Snare rim',
  crossStick: 'Cross stick',
  tomHigh: 'High tom',
  hhClosed: 'Hi-hat (closed)',
  hhOpen: 'Hi-hat (open)',
  rideBow: 'Ride',
  rideBell: 'Ride bell',
  rideEdge: 'Ride edge',
  crash1: 'Crash',
  crash2: 'Crash 2',
  splash: 'Splash',
}

function targetLabel(target: LearnTarget): string {
  return target.kind === 'hiHat' ? 'Hi-hat' : PAD_LABEL[target.pad]
}

function captureLabel(capture: LearnCapture): string {
  const step = currentStep(capture.stepIndex)
  return step === undefined ? `note ${capture.note}` : targetLabel(step.target)
}

/** "Note 38 is already your snare — hit a different pad." */
function conflictText(conflictNote: number, captures: readonly LearnCapture[]): string {
  const owner = captures.find((capture) => capture.note === conflictNote)
  const label = owner === undefined ? 'another pad' : captureLabel(owner).toLowerCase()
  return `Note ${conflictNote} is already your ${label} — hit a different pad`
}

export function KitMapLearnCard({ lastNoteOn, connected, onSave }: KitMapLearnCardProps) {
  const [wizard, setWizard] = useState<LearnState | undefined>(undefined)
  const [learnedOnce, setLearnedOnce] = useState(false)

  // Feeds every incoming note-on to the wizard while it is running. Keyed on
  // `seq` alone (not the whole `lastNoteOn` object, and not `wizard`) so a
  // repeat of the same note number still advances the wizard, and so the
  // effect never fires twice for one physical stroke; the guard inside the
  // updater (not a closed-over `wizard`) is what keeps this correct even if
  // Start/Cancel/Finish happened between renders.
  useEffect(() => {
    if (lastNoteOn === undefined) return
    setWizard((prev) => {
      if (prev === undefined || isFinished(prev.stepIndex)) return prev
      return captureNote(prev, lastNoteOn.note)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [lastNoteOn?.seq])

  const step = wizard === undefined ? undefined : currentStep(wizard.stepIndex)

  function handleStart() {
    setWizard(startLearn())
  }

  function handleSkip() {
    setWizard((prev) => (prev === undefined ? prev : skipStep(prev)))
  }

  function handleUndo() {
    setWizard((prev) => (prev === undefined ? prev : undoStep(prev)))
  }

  function handleCancel() {
    setWizard(undefined)
  }

  function handleFinish() {
    if (wizard === undefined) return
    onSave(kitMapFromCaptures(LEARNED_KIT_MAP_NAME, wizard.captures))
    setLearnedOnce(true)
    setWizard(undefined)
  }

  return (
    <div className="card field kit-map-learn-card">
      <h2>Learn your kit</h2>

      {wizard === undefined ? (
        <>
          <button type="button" className="btn-primary" disabled={!connected} onClick={handleStart}>
            {learnedOnce ? 'Learn kit again' : 'Learn kit'}
          </button>
          {!connected && <p>Connect your e-kit to learn it.</p>}
        </>
      ) : (
        <>
          {step !== undefined ? (
            <h3>{step.prompt}</h3>
          ) : (
            <h3>All set — press Finish to save your map</h3>
          )}

          <p role="status" aria-label="Learn kit progress">
            Captured {wizard.captures.length} of {LEARN_STEPS.length}
          </p>

          {wizard.conflict !== undefined && (
            <p role="alert" aria-label="Learn kit conflict">
              {conflictText(wizard.conflict, wizard.captures)}
            </p>
          )}

          <ul aria-label="Captured pads">
            {wizard.captures.map((capture) => (
              <li key={capture.stepIndex}>
                {captureLabel(capture)} — note {capture.note}
              </li>
            ))}
          </ul>

          <div className="groove-transport">
            <button type="button" disabled={step === undefined || step.required} onClick={handleSkip}>
              Skip
            </button>
            <button type="button" disabled={wizard.stepIndex === 0} onClick={handleUndo}>
              Undo
            </button>
            <button type="button" onClick={handleCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!requiredStepsDone(wizard.captures)}
              onClick={handleFinish}
            >
              Finish
            </button>
          </div>
        </>
      )}
    </div>
  )
}
