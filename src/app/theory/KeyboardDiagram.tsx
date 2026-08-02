/**
 * A display-only piano keyboard SVG (roadmap 3.8/3.9, REQ-3.5.3/REQ-3.5.4):
 * highlights an arbitrary set of pitch classes (a scale, a chord) across the
 * rendered range, with an optional per-key label (a degree name, a fingering
 * number).
 *
 * This is deliberately the *display* keyboard, not the *input* one —
 * `@app/drills/OnScreenKeyboard.tsx` answers "which key did the learner
 * press"; this one answers "which keys make up this scale/chord", so it takes
 * plain props and renders, with no click handling, no hooks and no ports.
 *
 * Highlighting is by **pitch class** (0=C .. 11=B), so it applies uniformly
 * across every octave drawn — a two-octave diagram highlighting C major lights
 * up both C4 and C5. `labels` is keyed by the absolute MIDI note instead,
 * because a fingering or a chord-tone label is a fact about one specific
 * rendered key, not about the pitch class in general (the same pitch class can
 * carry two different fingers across an octave span).
 */
import { invariant } from '@core/shared/invariant.ts'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, type Midi } from '@core/shared/units.ts'

export type KeyboardDiagramProps = {
  readonly low: Midi
  readonly high: Midi
  /** Pitch classes (0-11) to highlight, independent of octave. */
  readonly highlightedPitchClasses: ReadonlySet<number>
  /** The pitch class to mark as the root/tonic, drawn with its own styling. */
  readonly rootPitchClass?: number
  /** Per-key text, keyed by the absolute MIDI note number it labels. */
  readonly labels?: ReadonlyMap<number, string>
  readonly ariaLabel?: string
}

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])
const WHITE_KEY_WIDTH = 24
const WHITE_KEY_HEIGHT = 110
const BLACK_KEY_WIDTH = 14
const BLACK_KEY_HEIGHT = 68

function isBlackKey(note: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

function pitchClassOf(note: number): number {
  return ((note % 12) + 12) % 12
}

type Key = { readonly note: number; readonly whiteIndex: number }

/** White keys get sequential slots; black keys sit between the white key they follow. */
function layout(low: Midi, high: Midi): { readonly whites: readonly Key[]; readonly blacks: readonly Key[] } {
  const whites: Key[] = []
  const blacks: Key[] = []
  let whiteIndex = -1
  for (let note = low; note <= high; note++) {
    if (isBlackKey(note)) {
      blacks.push({ note, whiteIndex })
    } else {
      whiteIndex += 1
      whites.push({ note, whiteIndex })
    }
  }
  return { whites, blacks }
}

export function KeyboardDiagram({
  low,
  high,
  highlightedPitchClasses,
  rootPitchClass,
  labels,
  ariaLabel = 'Keyboard diagram',
}: KeyboardDiagramProps) {
  const clampedLow = midi(Math.max(PIANO_LOWEST_MIDI, low))
  const clampedHigh = midi(Math.min(PIANO_HIGHEST_MIDI, high))
  invariant(
    clampedLow <= clampedHigh,
    `KeyboardDiagram: low (${clampedLow}) must not exceed high (${clampedHigh})`,
  )
  const { whites, blacks } = layout(clampedLow, clampedHigh)
  const width = Math.max(1, whites.length) * WHITE_KEY_WIDTH
  const height = WHITE_KEY_HEIGHT + 4

  return (
    <svg
      className="keyboard-diagram"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      data-testid="keyboard-diagram"
    >
      {whites.map(({ note, whiteIndex }) => {
        const pc = pitchClassOf(note)
        const isRoot = rootPitchClass === pc
        const isHighlighted = highlightedPitchClasses.has(pc)
        const label = labels?.get(note)
        const x = whiteIndex * WHITE_KEY_WIDTH
        return (
          <g
            key={note}
            data-testid={`keyboard-key-${note}`}
            data-pitch-class={pc}
            data-highlighted={isHighlighted}
            data-root={isRoot}
          >
            <rect
              x={x}
              y={0}
              width={WHITE_KEY_WIDTH}
              height={WHITE_KEY_HEIGHT}
              className={
                isRoot ? 'kd-key kd-key-white kd-root' : isHighlighted ? 'kd-key kd-key-white kd-highlight' : 'kd-key kd-key-white'
              }
              stroke="currentColor"
              fill={isRoot ? 'currentColor' : isHighlighted ? 'currentColor' : 'none'}
              fillOpacity={isRoot ? 0.55 : isHighlighted ? 0.3 : 0}
            />
            {label !== undefined && (
              <text
                x={x + WHITE_KEY_WIDTH / 2}
                y={WHITE_KEY_HEIGHT - 10}
                fontSize="10"
                textAnchor="middle"
                aria-hidden="true"
              >
                {label}
              </text>
            )}
          </g>
        )
      })}
      {blacks.map(({ note, whiteIndex }) => {
        const pc = pitchClassOf(note)
        const isRoot = rootPitchClass === pc
        const isHighlighted = highlightedPitchClasses.has(pc)
        const label = labels?.get(note)
        const x = (whiteIndex + 1) * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2
        return (
          <g
            key={note}
            data-testid={`keyboard-key-${note}`}
            data-pitch-class={pc}
            data-highlighted={isHighlighted}
            data-root={isRoot}
          >
            <rect
              x={x}
              y={0}
              width={BLACK_KEY_WIDTH}
              height={BLACK_KEY_HEIGHT}
              className={
                isRoot ? 'kd-key kd-key-black kd-root' : isHighlighted ? 'kd-key kd-key-black kd-highlight' : 'kd-key kd-key-black'
              }
              fill={isRoot ? 'currentColor' : isHighlighted ? 'currentColor' : 'black'}
              fillOpacity={isRoot ? 0.85 : isHighlighted ? 0.7 : 1}
            />
            {label !== undefined && (
              <text
                x={x + BLACK_KEY_WIDTH / 2}
                y={BLACK_KEY_HEIGHT - 8}
                fontSize="8"
                fill="white"
                textAnchor="middle"
                aria-hidden="true"
              >
                {label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
