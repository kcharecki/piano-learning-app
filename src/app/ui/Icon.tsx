/**
 * Inline icon renderer (roadmap UI-03, 2026-08-12 UI audit). Icons are
 * ALWAYS decorative here — the adjacent text, or the control's own
 * `aria-label` (see `.btn-icon` in `primitives.css`), carries the meaning —
 * so every icon renders `aria-hidden` and unfocusable, never as its own
 * accessible element. Size defaults to `1em` so an icon inside a button
 * scales with that button's font size with no per-call CSS.
 *
 * Path/primitive data lives in `src/design-system/icons/icons.ts`; this
 * component owns only the `<svg>` wrapper and the stroke/accessibility
 * contract shared by every icon.
 */
import { ICONS, type IconName, type IconPrimitive } from '../../design-system/icons/icons.ts'

export type IconProps = {
  readonly name: IconName
  /** CSS size (any valid `width`/`height` value). Defaults to `1em`. */
  readonly size?: number | string
}

const STROKE_WIDTH = 1.75

export function Icon({ name, size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name].map((primitive, index) => (
        <IconShape key={index} primitive={primitive} />
      ))}
    </svg>
  )
}

function IconShape({ primitive }: { readonly primitive: IconPrimitive }) {
  switch (primitive.kind) {
    case 'path':
      return <path d={primitive.d} />
    case 'circle':
      return <circle cx={primitive.cx} cy={primitive.cy} r={primitive.r} />
    case 'line':
      return <line x1={primitive.x1} y1={primitive.y1} x2={primitive.x2} y2={primitive.y2} />
    case 'rect':
      return (
        <rect
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          rx={primitive.rx}
        />
      )
  }
}
