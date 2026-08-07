/**
 * The Theory destination (roadmap 3.8/3.9, REQ-3.5.3/REQ-3.5.4): the circle of
 * fifths and the always-available chord & scale reference, composed so that
 * clicking a key on the circle drives the reference below it — selecting G
 * major shows G major's scale, fingering and diatonic chords.
 *
 * The reference keeps its own root/scale-type pickers independent of the
 * circle (REQ-3.5.4 asks for it to be usable on its own), so this screen is
 * the single owner of both pieces of state: the circle only ever *writes*
 * root/scaleType, and the reference's own pickers write the same state.
 */
import { keyFromFifths, keyOf, type Key } from '@core/theory/keys.ts'
import type { TheoryQuizKind } from '@core/drills/theory.ts'
import { spell, type SpelledPitch } from '@core/theory/pitch.ts'
import type { ScaleType } from '@core/theory/scales.ts'
import { useState } from 'react'
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

export type TheoryScreenProps = {
  /** Seeds the drill panel's topic when a planned lesson quiz named one
   *  (roadmap 3.12). `Shell` remounts this screen via `key` when the plan
   *  names a different topic, because the panel only seeds its state. */
  readonly initialDrillKind?: TheoryQuizKind
  /** Seeds the drill panel's level; the panel clamps it. */
  readonly initialDrillLevel?: number
}

export function TheoryScreen(props: TheoryScreenProps = {}) {
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

  return (
    <div className="theory-screen">
      <h1>Theory</h1>
      {/* Spread rather than `initialKind={...}`: `exactOptionalPropertyTypes`
          makes an explicit `undefined` a type error on an optional prop. */}
      <TheoryDrillPanel
        {...(props.initialDrillKind === undefined ? {} : { initialKind: props.initialDrillKind })}
        {...(props.initialDrillLevel === undefined
          ? {}
          : { initialLevel: props.initialDrillLevel })}
      />
      <section aria-label="Circle of fifths explorer">
        {selectedKey === undefined ? (
          <CircleOfFifths onSelect={handleSelectKey} />
        ) : (
          <CircleOfFifths selected={selectedKey} onSelect={handleSelectKey} />
        )}
      </section>
      <ChordScaleReference
        root={root}
        scaleType={scaleType}
        onRootChange={setRoot}
        onScaleTypeChange={setScaleType}
      />
    </div>
  )
}
