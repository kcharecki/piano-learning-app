/**
 * Icon path data (roadmap UI-03, 2026-08-12 UI audit): the app had no icons
 * beyond the ☰ hamburger and Unicode clef glyphs — nav was 13 text labels,
 * Play/Pause/Stop/Record/Tap/Add were text-only, and MIDI connected/not had
 * no glyph cue at all, which breaks the "color is never the only signal"
 * rule. One consistent family, drawn by hand in a Lucide-style vocabulary:
 * 24x24 viewBox, stroke only (no fills), round caps/joins, 1.75px stroke.
 *
 * This module owns path/primitive DATA ONLY. The `<svg>` wrapper — viewBox,
 * stroke attributes, size, and the accessibility contract (always
 * aria-hidden) — lives in `src/app/ui/Icon.tsx`. Keeping them apart means
 * adding an icon here never touches the wrapper, and changing the wrapper
 * (e.g. the stroke weight) never touches this file.
 *
 * A single `d` string cannot express every glyph — concentric circles
 * (target), independently strokeable bars (rhythm, chart), a keyboard's
 * separate black keys — so each icon is a small array of primitives instead
 * of one path.
 */

export type IconPrimitive =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly kind: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
    }
  | {
      readonly kind: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly rx?: number
    }

export type IconName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'record'
  | 'metronome'
  | 'keyboard'
  | 'ear'
  | 'rhythm'
  | 'hand'
  | 'book'
  | 'cards'
  | 'target'
  | 'chart'
  | 'settings'
  | 'midi-plug'
  | 'bluetooth'
  | 'check'
  | 'x'
  | 'chevron-down'
  | 'chevron-right'
  | 'plus'
  | 'minus'
  | 'clock'
  | 'flame'

export const ICONS: Readonly<Record<IconName, readonly IconPrimitive[]>> = {
  play: [{ kind: 'path', d: 'M7 4l13 8-13 8Z' }],

  pause: [
    { kind: 'rect', x: 6, y: 4, width: 4, height: 16, rx: 1 },
    { kind: 'rect', x: 14, y: 4, width: 4, height: 16, rx: 1 },
  ],

  stop: [{ kind: 'rect', x: 5, y: 5, width: 14, height: 14, rx: 2 }],

  record: [{ kind: 'circle', cx: 12, cy: 12, r: 6 }],

  metronome: [
    { kind: 'path', d: 'M9 3h6l3 17H6L9 3Z' },
    { kind: 'line', x1: 12, y1: 6, x2: 16, y2: 17 },
  ],

  keyboard: [
    { kind: 'rect', x: 2, y: 5, width: 20, height: 14, rx: 2 },
    { kind: 'line', x1: 7, y1: 5, x2: 7, y2: 12 },
    { kind: 'line', x1: 11, y1: 5, x2: 11, y2: 12 },
    { kind: 'line', x1: 15, y1: 5, x2: 15, y2: 12 },
    { kind: 'line', x1: 19, y1: 5, x2: 19, y2: 12 },
  ],

  ear: [
    { kind: 'path', d: 'M9 4c4-1 8 2 8 7 0 3-2 4-2 7a3 3 0 0 1-6 0v-2' },
    { kind: 'path', d: 'M9 12a2 2 0 0 0 2-2' },
  ],

  rhythm: [
    { kind: 'line', x1: 5, y1: 19, x2: 5, y2: 10 },
    { kind: 'line', x1: 10, y1: 19, x2: 10, y2: 5 },
    { kind: 'line', x1: 15, y1: 19, x2: 15, y2: 13 },
    { kind: 'line', x1: 19, y1: 19, x2: 19, y2: 8 },
  ],

  hand: [
    { kind: 'rect', x: 6, y: 13, width: 12, height: 8, rx: 3 },
    { kind: 'line', x1: 8, y1: 13, x2: 8, y2: 6 },
    { kind: 'line', x1: 11, y1: 13, x2: 11, y2: 4 },
    { kind: 'line', x1: 14, y1: 13, x2: 14, y2: 4 },
    { kind: 'line', x1: 17, y1: 13, x2: 17, y2: 7 },
    { kind: 'line', x1: 6, y1: 15, x2: 3, y2: 12 },
  ],

  book: [
    { kind: 'path', d: 'M4 5c2-1 5-1 7 0v14c-2-1-5-1-7 0V5Z' },
    { kind: 'path', d: 'M20 5c-2-1-5-1-7 0v14c2-1 5-1 7 0V5Z' },
  ],

  cards: [
    { kind: 'rect', x: 6, y: 2, width: 13, height: 17, rx: 2 },
    { kind: 'rect', x: 3, y: 6, width: 13, height: 17, rx: 2 },
  ],

  target: [
    { kind: 'circle', cx: 12, cy: 12, r: 9 },
    { kind: 'circle', cx: 12, cy: 12, r: 5.5 },
    { kind: 'circle', cx: 12, cy: 12, r: 2 },
  ],

  chart: [
    { kind: 'path', d: 'M4 4v16h16' },
    { kind: 'line', x1: 8, y1: 17, x2: 8, y2: 12 },
    { kind: 'line', x1: 12, y1: 17, x2: 12, y2: 8 },
    { kind: 'line', x1: 16, y1: 17, x2: 16, y2: 13 },
  ],

  settings: [
    { kind: 'circle', cx: 12, cy: 12, r: 3 },
    { kind: 'line', x1: 12, y1: 2, x2: 12, y2: 5 },
    { kind: 'line', x1: 12, y1: 19, x2: 12, y2: 22 },
    { kind: 'line', x1: 2, y1: 12, x2: 5, y2: 12 },
    { kind: 'line', x1: 19, y1: 12, x2: 22, y2: 12 },
    { kind: 'line', x1: 4.2, y1: 4.2, x2: 6.3, y2: 6.3 },
    { kind: 'line', x1: 17.7, y1: 17.7, x2: 19.8, y2: 19.8 },
    { kind: 'line', x1: 4.2, y1: 19.8, x2: 6.3, y2: 17.7 },
    { kind: 'line', x1: 17.7, y1: 6.3, x2: 19.8, y2: 4.2 },
  ],

  'midi-plug': [
    { kind: 'circle', cx: 12, cy: 11, r: 8 },
    { kind: 'circle', cx: 9, cy: 9, r: 0.8 },
    { kind: 'circle', cx: 15, cy: 9, r: 0.8 },
    { kind: 'circle', cx: 12, cy: 14, r: 0.8 },
    { kind: 'rect', x: 10, y: 19, width: 4, height: 3, rx: 1 },
  ],

  bluetooth: [{ kind: 'path', d: 'M7 7l10 10-5 5V2l5 5L7 17' }],

  check: [{ kind: 'path', d: 'M5 13l4 4L19 7' }],

  x: [
    { kind: 'line', x1: 6, y1: 6, x2: 18, y2: 18 },
    { kind: 'line', x1: 18, y1: 6, x2: 6, y2: 18 },
  ],

  'chevron-down': [{ kind: 'path', d: 'M6 9l6 6 6-6' }],

  'chevron-right': [{ kind: 'path', d: 'M9 6l6 6-6 6' }],

  plus: [
    { kind: 'line', x1: 12, y1: 5, x2: 12, y2: 19 },
    { kind: 'line', x1: 5, y1: 12, x2: 19, y2: 12 },
  ],

  minus: [{ kind: 'line', x1: 5, y1: 12, x2: 19, y2: 12 }],

  clock: [
    { kind: 'circle', cx: 12, cy: 12, r: 9 },
    { kind: 'line', x1: 12, y1: 12, x2: 12, y2: 7 },
    { kind: 'line', x1: 12, y1: 12, x2: 16, y2: 14 },
  ],

  flame: [
    {
      kind: 'path',
      d: 'M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-2-1-3-1-3 2 1 3 3 3 6a5 5 0 0 1-10 0c0-5 3-6 5-12Z',
    },
  ],
}
