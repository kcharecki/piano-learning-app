/**
 * The circle of fifths (roadmap 3.8, REQ-3.5.3): twelve major keys around the
 * outside, their relative minors around the inside, each a real focusable
 * control. Selecting a wedge reports the key it names; the selected key, its
 * relative, and its closely-related neighbours (`relativeKey` /
 * `closelyRelatedKeys` from `@core/theory/keys.ts`) are highlighted — this
 * component never re-derives those relationships itself.
 *
 * Twelve stations are drawn, fifths -5..+6 (Db .. F#), which is the
 * conventional printed circle: every other key signature (Cb, Gb, C#) is an
 * enharmonic respelling of one already shown, and is annotated on that
 * station's label via `enharmonicKey` rather than drawn twice. C major
 * (fifths 0) sits at the top; sharp keys run clockwise, flat keys
 * counter-clockwise, matching the printed chart.
 */
import {
  closelyRelatedKeys,
  enharmonicKey,
  type Key,
  keyFromFifths,
  relativeKey,
} from '@core/theory/keys.ts'
import type { KeyboardEvent } from 'react'

export type CircleOfFifthsProps = {
  readonly selected?: Key
  readonly onSelect: (key: Key) => void
}

const STATION_COUNT = 12
const LOWEST_FIFTHS = -5
const CENTER = 200
const OUTER_RADIUS = 190
const MID_RADIUS = 122
const INNER_RADIUS = 58
const SLICE_DEGREES = 360 / STATION_COUNT

/** The twelve fifths values drawn, -5..+6, ordered station 0..11. */
const STATION_FIFTHS: readonly number[] = Array.from(
  { length: STATION_COUNT },
  (_, i) => LOWEST_FIFTHS + i,
)

function polar(radius: number, angleDeg: number): { readonly x: number; readonly y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) }
}

/** C major (fifths 0) is drawn at the top; each fifth moves 30° clockwise. */
function angleForFifths(fifths: number): number {
  return fifths * SLICE_DEGREES
}

/** An SVG path for one annulus sector (a "wedge") between two radii. */
function wedgePath(rOuter: number, rInner: number, fifths: number): string {
  const centerAngle = angleForFifths(fifths)
  const start = centerAngle - SLICE_DEGREES / 2
  const end = centerAngle + SLICE_DEGREES / 2
  const p1 = polar(rOuter, start)
  const p2 = polar(rOuter, end)
  const p3 = polar(rInner, end)
  const p4 = polar(rInner, start)
  return (
    `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 0 1 ${p2.x} ${p2.y} ` +
    `L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 0 0 ${p4.x} ${p4.y} Z`
  )
}

function labelPos(radius: number, fifths: number): { readonly x: number; readonly y: number } {
  return polar(radius, angleForFifths(fifths))
}

/** `'F#'`, or `'F#/Gb'` where an enharmonic respelling of the same key exists. */
function tonicText(key: Key): string {
  const sign = key.tonic.alter < 0 ? 'b'.repeat(-key.tonic.alter) : '#'.repeat(key.tonic.alter)
  return `${key.tonic.letter}${sign}`
}

function labelText(key: Key): string {
  const twin = enharmonicKey(key)
  return twin === null ? tonicText(key) : `${tonicText(key)}/${tonicText(twin)}`
}

type Highlight = 'selected' | 'relative' | 'related' | 'none'

function sameKey(a: Key, b: Key): boolean {
  return a.signature.fifths === b.signature.fifths && a.mode === b.mode
}

/** `key` matches `other`, or matches the drawn twin of `other`'s enharmonic respelling —
 *  needed for the two rim stations, where a related key can fall just past the drawn
 *  -5..+6 range and only its enharmonic equivalent has a wedge (see the finding on
 *  `highlightFor` not wrapping). */
function matchesOrEnharmonic(key: Key, other: Key): boolean {
  if (sameKey(key, other)) return true
  const twin = enharmonicKey(other)
  return twin !== null && sameKey(key, twin)
}

function highlightFor(key: Key, selected: Key | undefined): Highlight {
  if (selected === undefined) return 'none'
  if (matchesOrEnharmonic(key, selected)) return 'selected'
  if (matchesOrEnharmonic(key, relativeKey(selected))) return 'relative'
  if (closelyRelatedKeys(selected).some((r) => matchesOrEnharmonic(key, r))) return 'related'
  return 'none'
}

function Wedge({
  wedgeKey,
  rOuter,
  rInner,
  selected,
  onSelect,
}: {
  readonly wedgeKey: Key
  readonly rOuter: number
  readonly rInner: number
  readonly selected: Key | undefined
  readonly onSelect: (key: Key) => void
}) {
  const highlight = highlightFor(wedgeKey, selected)
  const label = labelPos((rOuter + rInner) / 2, wedgeKey.signature.fifths)
  const name = `${labelText(wedgeKey)} ${wedgeKey.mode}`
  const fillOpacity = highlight === 'none' ? 0.05 : highlight === 'selected' ? 0.5 : 0.25

  const handleKeyDown = (e: KeyboardEvent<SVGGElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(wedgeKey)
    }
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-selected={highlight === 'selected'}
      data-testid={`circle-key-${wedgeKey.mode}-${wedgeKey.signature.fifths}`}
      data-highlight={highlight}
      onClick={() => onSelect(wedgeKey)}
      onKeyDown={handleKeyDown}
      className={`wedge wedge-${wedgeKey.mode}${
        highlight === 'selected' ? ' is-selected' : ''
      }${highlight === 'relative' || highlight === 'related' ? ' is-related' : ''}`}
    >
      <path
        d={wedgePath(rOuter, rInner, wedgeKey.signature.fifths)}
        stroke="currentColor"
        fill="currentColor"
        fillOpacity={fillOpacity}
      />
      <text
        x={label.x}
        y={label.y}
        fontSize="13"
        textAnchor="middle"
        dominantBaseline="middle"
        aria-hidden="true"
      >
        {labelText(wedgeKey)}
      </text>
    </g>
  )
}

export function CircleOfFifths({ selected, onSelect }: CircleOfFifthsProps) {
  const majors = STATION_FIFTHS.map((fifths) => keyFromFifths(fifths, 'major'))

  return (
    <svg
      className="circle-of-fifths"
      viewBox={`0 0 ${CENTER * 2} ${CENTER * 2}`}
      role="group"
      aria-label="Circle of fifths"
      data-testid="circle-of-fifths"
    >
      {majors.map((majorKey) => (
        <Wedge
          key={`major-${majorKey.signature.fifths}`}
          wedgeKey={majorKey}
          rOuter={OUTER_RADIUS}
          rInner={MID_RADIUS}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {majors.map((majorKey) => {
        const minorKey = relativeKey(majorKey)
        return (
          <Wedge
            key={`minor-${minorKey.signature.fifths}`}
            wedgeKey={minorKey}
            rOuter={MID_RADIUS}
            rInner={INNER_RADIUS}
            selected={selected}
            onSelect={onSelect}
          />
        )
      })}
    </svg>
  )
}
