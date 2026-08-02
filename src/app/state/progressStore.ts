/**
 * Assessment results, MIDI recordings and the practice log (roadmap 2.24,
 * REQ-3.3.4/3.9.2/3.9.5) — everything a review screen or the progress log
 * needs to survive a reload, in one store.
 *
 * STATE ONLY, matching flashcardStore/sightReadingStore's own rule: this
 * module never decides what to store or when — `useAssessment` appends a
 * finished `AssessmentResult`, `useRecorder` appends a completed take, and
 * `usePracticeLog` appends a finished `PracticeEntry`, each already built by
 * the core module that owns that decision (`assess()`, `MidiRecorder.stop()`,
 * `PracticeTimer.stop()`).
 *
 * All three lists are newest-first and capped, because `persistence.ts`
 * writes each one to IndexedDB wholesale on every change (the roadmap-2.18
 * write queue), and an uncapped history would grow the saved blob without
 * bound. Recordings are capped tightest — a MIDI event stream per take is far
 * bigger than one scalar assessment result or one practice-log line.
 *
 * `hydrate` (roadmap 2.24) applies a PARTIAL state: `persistence.ts` restores
 * each of the three collections independently (its own key, own validation,
 * own failure mode), so a caller that only has one collection's data back
 * from storage must be able to apply it without clobbering the other two,
 * which may not have resolved yet. Zustand's `set` already shallow-merges a
 * plain object, so `hydrate` is a thin pass-through — never `set(state, true)`.
 */
import type { AssessmentResult } from '@core/practice/assessment.ts'
import type { Recording } from '@core/practice/recorder.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { create } from 'zustand'

/** Caps below — see the module comment on why each collection is bounded. */
export const MAX_STORED_ASSESSMENTS = 50
export const MAX_STORED_RECORDINGS = 10
export const MAX_STORED_PRACTICE_ENTRIES = 500

export type StoredAssessment = {
  readonly id: string
  readonly scoreId: string
  readonly scoreTitle: string
  /** Epoch ms the assessment was recorded into this store — a `DateSource` reading. */
  readonly at: number
  readonly result: AssessmentResult
}

export type ProgressStoreState = {
  /** Newest first, capped at `MAX_STORED_ASSESSMENTS`. */
  readonly assessments: readonly StoredAssessment[]
  /** Newest first, capped at `MAX_STORED_RECORDINGS`. */
  readonly recordings: readonly Recording[]
  /** Newest first, capped at `MAX_STORED_PRACTICE_ENTRIES`. */
  readonly practiceEntries: readonly PracticeEntry[]
}

export type ProgressStoreActions = {
  /** Prepends `assessment`; anything beyond `MAX_STORED_ASSESSMENTS` is dropped. */
  addAssessment(assessment: StoredAssessment): void
  /** Prepends `recording`; anything beyond `MAX_STORED_RECORDINGS` is dropped. */
  addRecording(recording: Recording): void
  /** Prepends `entry`; anything beyond `MAX_STORED_PRACTICE_ENTRIES` is dropped. */
  addPracticeEntry(entry: PracticeEntry): void
  /**
   * Replaces whichever of the three collections `state` supplies, leaving the
   * others untouched — see the module comment. Used only by `persistence.ts`'s
   * `restoreSession`; every other caller keeps using the `addXxx` actions.
   */
  hydrate(state: Partial<ProgressStoreState>): void
}

export type ProgressStore = ProgressStoreState & ProgressStoreActions

export const useProgressStore = create<ProgressStore>((set) => ({
  assessments: [],
  recordings: [],
  practiceEntries: [],

  addAssessment: (assessment) =>
    set((state) => ({
      assessments: [assessment, ...state.assessments].slice(0, MAX_STORED_ASSESSMENTS),
    })),
  addRecording: (recording) =>
    set((state) => ({
      recordings: [recording, ...state.recordings].slice(0, MAX_STORED_RECORDINGS),
    })),
  addPracticeEntry: (entry) =>
    set((state) => ({
      practiceEntries: [entry, ...state.practiceEntries].slice(0, MAX_STORED_PRACTICE_ENTRIES),
    })),
  hydrate: (state) => set(state),
}))
