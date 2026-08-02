/**
 * A small, dependency-free SVG line/bar chart (roadmap 4.7, REQ-3.10.1):
 * points in, an SVG out. Purely presentational — no hooks, no store reads,
 * no knowledge of what the numbers mean.
 *
 * The empty series (`points: []`) and the single-point series are the two
 * cases a naive "normalize into the axis range" implementation gets wrong:
 * dividing by a zero range (`max === min`, or only one point so there is no
 * "span" to spread across) produces `NaN` coordinates, and `NaN` in a `path`
 * `d` attribute is not an error — the browser silently renders nothing.
 * Every coordinate helper below (`xAt`/`yAt`) is written to fall back to a
 * defined value instead of dividing by zero, and `TrendChart.test.tsx` reads
 * the rendered `d`/`cx`/`cy` attributes back and asserts they never contain
 * the string `"NaN"`, for exactly this reason.
 */

export type TrendChartPoint = {
  readonly label: string
  readonly value: number
}

export type TrendChartKind = 'line' | 'bar'

export type TrendChartProps = {
  readonly points: readonly TrendChartPoint[]
  readonly kind?: TrendChartKind
  readonly width?: number
  readonly height?: number
  /** Accessible name for the chart's `role="img"`. Required — a chart with no name is unusable with a screen reader. */
  readonly ariaLabel: string
  /** Appended to each point's tooltip value, e.g. `" min"`, `"%"`. */
  readonly valueSuffix?: string
}

const DEFAULT_WIDTH = 280
const DEFAULT_HEIGHT = 80
const PADDING = 8
const POINT_RADIUS = 2.5

function formatValue(value: number, suffix: string): string {
  return `${value}${suffix}`
}

export function TrendChart(props: TrendChartProps) {
  const {
    points,
    kind = 'line',
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    ariaLabel,
    valueSuffix = '',
  } = props

  const innerWidth = width - PADDING * 2
  const innerHeight = height - PADDING * 2

  // Guaranteed non-empty so Math.max/min never receive zero arguments (which
  // would itself be fine for max but throw nothing useful for reasoning
  // about) — the real guard is `valueRange <= 0` below, this just keeps the
  // two calls symmetric and simple.
  const values = points.length > 0 ? points.map((p) => p.value) : [0]
  const maxValue = kind === 'bar' ? Math.max(0, ...values) : Math.max(...values)
  const minValue = kind === 'bar' ? Math.min(0, ...values) : Math.min(...values)
  const valueRange = maxValue - minValue

  /** X position for the point at `index`, of `points.length` total. Centered when there is only one (or zero). */
  function xAt(index: number): number {
    if (points.length <= 1) return PADDING + innerWidth / 2
    return PADDING + (index / (points.length - 1)) * innerWidth
  }

  /** Y position for `value`. Falls back to a defined baseline when the series has no range to spread across. */
  function yAt(value: number): number {
    if (valueRange <= 0) return kind === 'bar' ? PADDING + innerHeight : PADDING + innerHeight / 2
    return PADDING + innerHeight - ((value - minValue) / valueRange) * innerHeight
  }

  const pathD =
    kind === 'line' && points.length >= 2
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(p.value).toFixed(2)}`).join(' ')
      : undefined

  const barSlot = innerWidth / Math.max(points.length, 1)
  const barWidth = Math.max(2, barSlot - 4)

  /** Left edge of the bar at `index`, placed in its own slot so the first and last bars never spill past the viewBox. */
  function barXAt(index: number): number {
    return PADDING + index * barSlot + (barSlot - barWidth) / 2
  }

  return (
    <svg
      className="trend-chart"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      {points.length === 0 && (
        <text x={width / 2} y={height / 2} textAnchor="middle" className="trend-chart-empty">
          No data
        </text>
      )}

      {kind === 'bar' &&
        points.map((p, i) => {
          const y = yAt(p.value)
          const barHeight = Math.max(0, PADDING + innerHeight - y)
          return (
            <rect
              key={`${p.label}-${i}`}
              x={barXAt(i)}
              y={y}
              width={barWidth}
              height={barHeight}
              className="trend-chart-bar"
            >
              <title>{`${p.label}: ${formatValue(p.value, valueSuffix)}`}</title>
            </rect>
          )
        })}

      {pathD !== undefined && <path d={pathD} className="trend-chart-line" fill="none" />}

      {kind === 'line' &&
        points.map((p, i) => (
          <circle
            key={`${p.label}-${i}`}
            cx={xAt(i)}
            cy={yAt(p.value)}
            r={POINT_RADIUS}
            className="trend-chart-point"
          >
            <title>{`${p.label}: ${formatValue(p.value, valueSuffix)}`}</title>
          </circle>
        ))}
    </svg>
  )
}
