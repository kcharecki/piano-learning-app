/**
 * The Theory destination (roadmap 3.8/3.9/UI-17, REQ-3.5.3/REQ-3.5.4): four
 * tools — drills, the circle of fifths, the chord & scale reference and the
 * chord lookup — behind an in-page tab bar, not one long stacked page.
 *
 * REWORKED (roadmap UI-17, 2026-08-12 UI audit): the previous shape stacked
 * all four tools on a single ~5,400px page with no signal at the top that
 * four separate things lived there. Tabs are local `useState` only — no
 * route change, so `Shell`'s deep-link-to-a-drill mechanism (`initialDrillKind`/
 * `initialDrillLevel`, remounted via `key` when the plan names a different
 * topic) keeps working exactly as before: those props still only seed
 * `TheoryDrillPanel`'s own state, and this screen additionally defaults its
 * own tab selection to Drills, so a deep-linked drill actually lands the
 * learner in front of it.
 *
 * Only the ACTIVE tab's content is mounted — not merely hidden via CSS. This
 * matters beyond "one long page": `TheoryDrillPanel` runs an unconditional
 * `useQwertyNoteInput` (computer-keyboard note entry) and a MIDI listener, so
 * leaving it mounted while another tab is showing would let stray key
 * presses answer a drill the learner cannot even see. Switching away and
 * back re-seeds from whatever is due in the SRS store (the same seeding
 * `TheoryDrillPanel` already does at every mount), so nothing about the
 * learner's recall schedule is lost — only an in-flight, unanswered attempt's
 * transient note-by-note progress resets, same as navigating away today.
 *
 * The circle of fifths and the reference still drive each other exactly as
 * before: this screen is the single owner of `root`/`scaleType`, the circle
 * only ever *writes* them, and the reference's own pickers write the same
 * state — switching tabs does not reset either.
 *
 * `ChordLookup` used to be composed INSIDE `ChordScaleReference`, reseeded via
 * a `key` whenever the reference's root changed. It is now this screen's own
 * fourth tab (roadmap UI-17's target explicitly lists it as a separate tool,
 * not a sub-section of the reference) — the same `key`-reseed trick still
 * applies, just one level up, so selecting a new root on the Scales & chords
 * tab still re-seeds a fresh Chord lookup session the next time that tab is
 * opened.
 */
import { useState } from 'react'
import type { AudioOutput } from '@core/ports/audio.ts'
import { keyFromFifths, keyOf, type Key } from '@core/theory/keys.ts'
import type { TheoryQuizKind } from '@core/drills/theory.ts'
import { spell, type SpelledPitch } from '@core/theory/pitch.ts'
import type { ScaleType } from '@core/theory/scales.ts'
import { ChordLookup } from './ChordLookup.tsx'
import { ChordScaleReference } from './ChordScaleReference.tsx'
import { CircleOfFifths } from './CircleOfFifths.tsx'
import { TheoryDrillPanel } from './TheoryDrillPanel.tsx'

const DEFAULT_KEY = keyFromFifths(0, 'major')

const MINOR_SCALE_TYPES: ReadonlySet<ScaleType> = new Set<ScaleType>([
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'aeolian',
])

function scaleTypeForKey(key: Key): ScaleType {
  return key.mode === 'major' ? 'major' : 'naturalMinor'
}

type TheoryTabId = 'drills' | 'circle' | 'reference' | 'lookup'

const TABS: readonly { readonly id: TheoryTabId; readonly label: string }[] = [
  { id: 'drills', label: 'Drills' },
  { id: 'circle', label: 'Circle of fifths' },
  { id: 'reference', label: 'Scales & chords' },
  { id: 'lookup', label: 'Chord lookup' },
]

export type TheoryScreenProps = {
  /** Seeds the drill panel's topic when a planned lesson quiz named one
   *  (roadmap 3.12). `Shell` remounts this screen via `key` when the plan
   *  names a different topic, because the panel only seeds its state. Also
   *  used by this screen itself (roadmap UI-17) to preselect the Drills tab —
   *  a deep link to a drill must land the learner in front of it, not on
   *  whichever tab happens to be first. */
  readonly initialDrillKind?: TheoryQuizKind
  /** Seeds the drill panel's level; the panel clamps it. */
  readonly initialDrillLevel?: number
  /** Injection seam for tests; each of the reference and the lookup default
   *  to the real, lazily-built Web Audio output otherwise (see
   *  `chordScaleAudio.ts`'s `useSharedAudioOutput` — both already resolve to
   *  the SAME shared `AudioContext` singleton with no prop at all, since
   *  `createDefaultAudioOutput` caches one instance module-wide). */
  readonly audioOutput?: AudioOutput
}

export function TheoryScreen(props: TheoryScreenProps = {}) {
  // Drills is always the default: it is this screen's one primary action
  // (rule 1 of the nine screen rules — "Start"/"Begin" a drill counts as a
  // primary), and it is also where a deep-linked drill must land, so the two
  // requirements collapse into one default rather than needing separate
  // "normal default" vs. "deep-link default" branches.
  const [tab, setTab] = useState<TheoryTabId>('drills')
  const [root, setRoot] = useState<SpelledPitch>(DEFAULT_KEY.tonic)
  const [scaleType, setScaleType] = useState<ScaleType>(scaleTypeForKey(DEFAULT_KEY))

  // Derived, not stored: the circle's own selection is whatever key the
  // current root/scaleType imply, so the Root/Scale pickers (which only ever
  // write root/scaleType) can never leave the circle's highlight stale (see
  // the finding on the formerly-independent `selectedKey` state).
  const mode: 'major' | 'minor' = MINOR_SCALE_TYPES.has(scaleType) ? 'minor' : 'major'
  const keyResult = keyOf(root, mode)
  const selectedKey = keyResult.ok ? keyResult.value : undefined

  const handleSelectKey = (key: Key): void => {
    setRoot(spell(key.tonic.letter, key.tonic.alter, key.tonic.octave))
    setScaleType(scaleTypeForKey(key))
  }

  const audioOutputProp = props.audioOutput === undefined ? {} : { audioOutput: props.audioOutput }

  return (
    <div className="page page--wide theory-screen">
      <div className="page-header">
        <h1>Theory</h1>
      </div>

      {/* `.seg-control` tab bar (roadmap UI-17 — the brief's own choice over
          primitives.css's separate underline-style `[role="tablist"]` block):
          `role="tablist"`/`role="tab"`/`aria-selected` for correct tab
          semantics, plus a `.selected` class because `.seg-control`'s own
          highlight hooks (`[aria-checked]`, `[aria-current]`, `.selected`)
          do not include `aria-selected` — see primitives.css's own comment
          on which hooks it reads. Selection lives in `useState` only, no
          route change, so a deep-linked drill's URL/history stays whatever
          it already was. */}
      <div className="seg-control" role="tablist" aria-label="Theory tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`theory-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`theory-panel-${t.id}`}
            className={tab === t.id ? 'selected' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`theory-panel-${tab}`}
        aria-labelledby={`theory-tab-${tab}`}
        className="theory-tabpanel"
      >
        {tab === 'drills' && (
          <TheoryDrillPanel
            {...(props.initialDrillKind === undefined
              ? {}
              : { initialKind: props.initialDrillKind })}
            {...(props.initialDrillLevel === undefined
              ? {}
              : { initialLevel: props.initialDrillLevel })}
          />
        )}

        {tab === 'circle' && (
          <section className="card theory-circle-card" aria-label="Circle of fifths explorer">
            {selectedKey === undefined ? (
              <CircleOfFifths onSelect={handleSelectKey} />
            ) : (
              <CircleOfFifths selected={selectedKey} onSelect={handleSelectKey} />
            )}
          </section>
        )}

        {tab === 'reference' && (
          <ChordScaleReference
            root={root}
            scaleType={scaleType}
            onRootChange={setRoot}
            onScaleTypeChange={setScaleType}
            {...audioOutputProp}
          />
        )}

        {tab === 'lookup' && (
          // `key` re-seeds the lookup's root whenever the reference's own
          // root changes (see this file's module comment on why this moved
          // up from ChordScaleReference): `initialRoot` is otherwise read
          // only at mount, so without a key that reads `root`, opening this
          // tab twice after picking a different root on the reference tab
          // would still show the FIRST root it ever mounted with.
          <ChordLookup key={`${root.letter}${root.alter}`} initialRoot={root} {...audioOutputProp} />
        )}
      </div>
    </div>
  )
}
