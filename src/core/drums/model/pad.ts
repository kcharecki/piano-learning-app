/**
 * `DrumPad` — the app's pad vocabulary (DR-04). Every trainer, the renderer and
 * the MusicXML bridge speak this identity; raw e-kit MIDI note numbers are
 * translated to/from it only at the kit-map edge (DR-02's job, not this
 * module's). `unmapped` is what a live hit becomes when the kit map can't
 * classify it — it never appears in authored/notated content.
 *
 * Three derived groupings hang off a pad, each a pure lookup table sourced
 * from research-2026-08-15.md §2 (notation) and §3 (GM/MIDI):
 *  - `limbOf`/`voiceOf` — which limb plays it, and the hands-stems-up /
 *    feet-stems-down notation convention that follows from that.
 *  - `staffPositionOf` — where it sits on a percussion staff (read as treble
 *    clef, per research §2) and which notehead shape it uses. The renderer
 *    (DR-05) owns turning this into pixels; this module owns the underlying
 *    fact because the MusicXML bridge (also DR-04) needs it to write
 *    `<display-step>`/`<display-octave>`/`<notehead>`.
 *  - `gmNoteOf` — the General MIDI percussion note used for playback
 *    (`<midi-unpitched>` in MusicXML, DR-06's synth). Never used to recover a
 *    pad from a live hit — that is the kit-map's job, not this module's.
 */

/**
 * The 16 real pads, in the app's canonical display/sort order (bottom-to-top
 * of a kit, hi-hat family grouped together). `DrumPad` is derived from this
 * array so the type and the runtime list can never drift apart.
 */
export const MAPPED_PADS = [
  'kick',
  'hhPedal',
  'tomFloor',
  'tomMid',
  'snare',
  'snareRim',
  'crossStick',
  'tomHigh',
  'hhClosed',
  'hhOpen',
  'rideBow',
  'rideBell',
  'rideEdge',
  'crash1',
  'crash2',
  'splash',
] as const

export type MappedDrumPad = (typeof MAPPED_PADS)[number]

/** `unmapped`: a live hit the kit map could not classify. Never in notated content. */
export type DrumPad = MappedDrumPad | 'unmapped'

export const PADS: readonly DrumPad[] = [...MAPPED_PADS, 'unmapped']

const PAD_ORDER: ReadonlyMap<DrumPad, number> = new Map(PADS.map((pad, i) => [pad, i]))

/** Canonical sort key for a pad — how `GrooveScore.notes` breaks a tie at the same tick. */
export function padOrderIndex(pad: DrumPad): number {
  return PAD_ORDER.get(pad) ?? PADS.length
}

export function isDrumPad(value: string): value is DrumPad {
  return PAD_ORDER.has(value as DrumPad)
}

const MAPPED_PAD_SET: ReadonlySet<string> = new Set(MAPPED_PADS)

/** True for exactly the 16 real pads — `false` for `unmapped` and for any unrecognised string. */
export function isMappedDrumPad(value: string): value is MappedDrumPad {
  return MAPPED_PAD_SET.has(value)
}

// ------------------------------------------------------------------- limb/voice

export type Limb = 'hand' | 'foot'
/** The hands-stems-up / feet-stems-down notation convention (research §2). */
export type Voice = 'hands' | 'feet'

const FOOT_PADS: ReadonlySet<DrumPad> = new Set<DrumPad>(['kick', 'hhPedal'])

/**
 * `undefined` for `unmapped` AND for any string that is not a real mapped pad
 * — this must fail closed: it used to default anything non-`'unmapped'` to
 * `'hand'`, which meant a bogus pad (e.g. a stray `'cowbell'`) silently got a
 * voice and sailed through `validateGrooveScore`'s voice check all the way to
 * `writeDrumMusicXml`'s "unreachable" throw. Checking real membership first
 * closes that hole at the source, rather than patching every caller.
 */
export function limbOf(pad: DrumPad): Limb | undefined {
  if (!isMappedDrumPad(pad)) return undefined
  return FOOT_PADS.has(pad) ? 'foot' : 'hand'
}

/** The stem direction a pad's notes must use. `undefined` only for `unmapped`. */
export function voiceOf(pad: DrumPad): Voice | undefined {
  const limb = limbOf(pad)
  if (limb === undefined) return undefined
  return limb === 'foot' ? 'feet' : 'hands'
}

// --------------------------------------------------------------- staff position

export type Notehead = 'normal' | 'x' | 'circleX' | 'diamond'
export type StaffStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type StaffPosition = {
  /** Scientific pitch notation, as if the pad were engraved in treble clef (research §2). */
  readonly step: StaffStep
  readonly octave: number
  readonly notehead: Notehead
}

/**
 * Sourced from research §2's table (kick..hi-hat-foot, 9 rows, PAS/Weinberg
 * convention) for every pad that table names. The extended set the app adds
 * beyond that table — `rideEdge`, `crash2`, `splash` — has no cited source;
 * positions there are an engineering judgment call (kept visually distinct,
 * never reused by another pad) rather than a researched convention. Note that
 * pad IDENTITY on MusicXML round-trip never depends on this table — see
 * `musicxml/instrument.ts` — so a wrong guess here is a display nit, not a
 * correctness bug.
 */
const STAFF_POSITION: Readonly<Record<MappedDrumPad, StaffPosition>> = {
  kick: { step: 'F', octave: 4, notehead: 'normal' }, // bottom space
  hhPedal: { step: 'D', octave: 4, notehead: 'x' }, // below staff
  tomFloor: { step: 'A', octave: 4, notehead: 'normal' }, // 2nd space
  tomMid: { step: 'B', octave: 4, notehead: 'normal' }, // middle line
  snare: { step: 'C', octave: 5, notehead: 'normal' }, // 3rd space
  // Rimshot has no notation of its own in most method books — it is written as
  // a normal snare note plus text/articulation, not a distinct notehead.
  snareRim: { step: 'C', octave: 5, notehead: 'normal' },
  crossStick: { step: 'C', octave: 5, notehead: 'x' }, // "x on snare position"
  tomHigh: { step: 'E', octave: 5, notehead: 'normal' }, // 4th space
  hhClosed: { step: 'G', octave: 5, notehead: 'x' }, // space above top line
  hhOpen: { step: 'G', octave: 5, notehead: 'x' },
  rideBow: { step: 'F', octave: 5, notehead: 'x' }, // top line
  rideBell: { step: 'F', octave: 5, notehead: 'diamond' },
  rideEdge: { step: 'F', octave: 5, notehead: 'circleX' }, // judgment call, see doc comment
  crash1: { step: 'A', octave: 5, notehead: 'x' }, // above staff
  crash2: { step: 'B', octave: 5, notehead: 'x' }, // judgment call
  splash: { step: 'C', octave: 6, notehead: 'x' }, // judgment call
}

/** `undefined` only for `unmapped`. */
export function staffPositionOf(pad: DrumPad): StaffPosition | undefined {
  return pad === 'unmapped' ? undefined : STAFF_POSITION[pad]
}

// -------------------------------------------------------------------- GM note

/**
 * General MIDI percussion note for playback (research §3's core-kit table).
 * `snareRim` (rimshot) has no GM patch of its own, so it reuses the acoustic
 * snare note (38) — a real GM limitation, not a bug; `crossStick` correctly
 * gets side stick (37), the one GM patch built for exactly that sound.
 * `rideEdge`/`crash2`/`splash` beyond the core table are this app's own
 * assignment from the wider GM percussion map (research §3), not the core
 * 9-row table.
 */
const GM_NOTE: Readonly<Record<MappedDrumPad, number>> = {
  kick: 36,
  hhPedal: 44,
  tomFloor: 43,
  tomMid: 47,
  snare: 38,
  snareRim: 38,
  crossStick: 37,
  tomHigh: 50,
  hhClosed: 42,
  hhOpen: 46,
  rideBow: 51,
  rideBell: 53,
  rideEdge: 59,
  crash1: 49,
  crash2: 57,
  splash: 55,
}

/** `undefined` only for `unmapped` — there is nothing to play back. */
export function gmNoteOf(pad: DrumPad): number | undefined {
  return pad === 'unmapped' ? undefined : GM_NOTE[pad]
}

// ------------------------------------------------------------- display name

/**
 * Canonical name written to MusicXML's `<instrument-name>` and read back to
 * recover pad identity (see `musicxml/instrument.ts`) — the actual source of
 * truth for round-tripping OUR OWN files, independent of `gmNoteOf`/
 * `staffPositionOf`, which can collide or be a judgment call without hurting
 * round-trip correctness.
 */
const INSTRUMENT_NAME: Readonly<Record<MappedDrumPad, string>> = {
  kick: 'Kick',
  hhPedal: 'Hi-Hat (Pedal)',
  tomFloor: 'Floor Tom',
  tomMid: 'Mid Tom',
  snare: 'Snare',
  snareRim: 'Snare (Rim)',
  crossStick: 'Cross Stick',
  tomHigh: 'High Tom',
  hhClosed: 'Hi-Hat (Closed)',
  hhOpen: 'Hi-Hat (Open)',
  rideBow: 'Ride (Bow)',
  rideBell: 'Ride (Bell)',
  rideEdge: 'Ride (Edge)',
  crash1: 'Crash 1',
  crash2: 'Crash 2',
  splash: 'Splash',
}

const PAD_BY_INSTRUMENT_NAME: ReadonlyMap<string, MappedDrumPad> = new Map(
  MAPPED_PADS.map((pad) => [INSTRUMENT_NAME[pad], pad]),
)

/** `undefined` only for `unmapped`. */
export function instrumentNameOf(pad: DrumPad): string | undefined {
  return pad === 'unmapped' ? undefined : INSTRUMENT_NAME[pad]
}

/** The inverse of `instrumentNameOf` — `undefined` for any name we did not write ourselves. */
export function padByInstrumentName(name: string): MappedDrumPad | undefined {
  return PAD_BY_INSTRUMENT_NAME.get(name)
}
