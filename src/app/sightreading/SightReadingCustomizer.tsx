/**
 * Exposes the generator parameters `core/generator/melody.ts` already
 * supports — key, range, rhythm, hands, accidentals, hand independence
 * (REQ-3.4.2) — as pickers over the level's own default exercise. A
 * collapsed `<details>` behind "Customize exercise", closed by default, so
 * the ordinary "press Start" path is unchanged for a learner who never opens
 * it. All of a controlled component: `customization`/`onChange` are owned by
 * `SightReadingScreen`; this file only lays the controls out and turns their
 * events into a merged `SightReadingCustomization`.
 */
import type { GeneratorParams, HandIndependence, RhythmStyle } from '@core/generator/melody.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { at } from '@core/shared/invariant.ts'
import {
  HANDS_OPTIONS,
  INDEPENDENCE_OPTIONS,
  keyLabel,
  MAJOR_KEYS,
  MINOR_KEYS,
  REGISTER_OPTIONS,
  RHYTHM_OPTIONS,
  type Register,
  type SightReadingCustomization,
} from './customization.ts'

export type SightReadingCustomizerProps = {
  readonly customization: SightReadingCustomization
  readonly onChange: (customization: SightReadingCustomization) => void
  /** Disables every control — e.g. mid-run. */
  readonly disabled?: boolean
}

const NO_KEY_SELECTED = '__level_default__'

export function SightReadingCustomizer({
  customization,
  onChange,
  disabled = false,
}: SightReadingCustomizerProps) {
  const keyMode = customization.key?.mode ?? 'major'
  const keyList = keyMode === 'major' ? MAJOR_KEYS : MINOR_KEYS
  const selectedFifthsIndex = customization.key === undefined ? undefined : customization.key.signature.fifths + 7

  return (
    <details className="sight-reading-customizer">
      <summary>Customize exercise</summary>

      <div className="field-row sight-reading-customizer-controls">
        <div className="field">
          <label htmlFor="sr-key-mode-select">Key</label>
          <div className="sight-reading-customizer-key-selects">
            <select
              id="sr-key-mode-select"
              disabled={disabled}
              value={keyMode}
              onChange={(e) => {
                const mode = e.target.value as 'major' | 'minor'
                const fifths = customization.key?.signature.fifths ?? 0
                onChange({ ...customization, key: keyFromFifths(fifths, mode) })
              }}
            >
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </select>
            <select
              id="sr-key-tonic-select"
              aria-label="Key tonic"
              disabled={disabled}
              value={selectedFifthsIndex ?? NO_KEY_SELECTED}
              onChange={(e) => {
                if (e.target.value === NO_KEY_SELECTED) {
                  const { key: _key, ...rest } = customization
                  onChange(rest)
                  return
                }
                onChange({ ...customization, key: at(keyList, Number(e.target.value)) })
              }}
            >
              <option value={NO_KEY_SELECTED}>Level's default</option>
              {keyList.map((key, i) => (
                <option key={i} value={i}>
                  {keyLabel(key)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="sr-hands-select">Hands</label>
          <select
            id="sr-hands-select"
            disabled={disabled}
            value={customization.hands ?? NO_KEY_SELECTED}
            onChange={(e) => {
              if (e.target.value === NO_KEY_SELECTED) {
                const { hands: _hands, ...rest } = customization
                onChange(rest)
                return
              }
              onChange({ ...customization, hands: e.target.value as GeneratorParams['hands'] })
            }}
          >
            <option value={NO_KEY_SELECTED}>Level's default</option>
            {HANDS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sr-rhythm-select">Rhythm</label>
          <select
            id="sr-rhythm-select"
            disabled={disabled}
            value={customization.rhythm ?? NO_KEY_SELECTED}
            onChange={(e) => {
              if (e.target.value === NO_KEY_SELECTED) {
                const { rhythm: _rhythm, ...rest } = customization
                onChange(rest)
                return
              }
              onChange({ ...customization, rhythm: e.target.value as RhythmStyle })
            }}
          >
            <option value={NO_KEY_SELECTED}>Level's default</option>
            {RHYTHM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {customization.hands === 'both' && (
          <div className="field">
            <label htmlFor="sr-independence-select">Hand independence</label>
            <select
              id="sr-independence-select"
              disabled={disabled}
              value={customization.handIndependence ?? NO_KEY_SELECTED}
              onChange={(e) => {
                if (e.target.value === NO_KEY_SELECTED) {
                  const { handIndependence: _handIndependence, ...rest } = customization
                  onChange(rest)
                  return
                }
                onChange({
                  ...customization,
                  handIndependence: e.target.value as HandIndependence,
                })
              }}
            >
              <option value={NO_KEY_SELECTED}>Level's default</option>
              {INDEPENDENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="sr-register-select">Range</label>
          <select
            id="sr-register-select"
            disabled={disabled}
            value={customization.register ?? 'default'}
            onChange={(e) => onChange({ ...customization, register: e.target.value as Register })}
          >
            {REGISTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Not a `.field`: rule 9 requires this exact
            `<label><input type="checkbox" />text</label>` shape, and
            `.field-inline`/`.field` both explicitly say not to double-wrap
            a checkbox/radio label in them (primitives.css). */}
        <label htmlFor="sr-no-accidentals-checkbox">
          <input
            id="sr-no-accidentals-checkbox"
            type="checkbox"
            disabled={disabled}
            checked={customization.noAccidentals === true}
            onChange={(e) => onChange({ ...customization, noAccidentals: e.target.checked })}
          />
          No accidentals
        </label>
      </div>

      <button
        type="button"
        className="sight-reading-customizer-reset"
        disabled={disabled}
        onClick={() => onChange({})}
      >
        Reset to level's default
      </button>
    </details>
  )
}
