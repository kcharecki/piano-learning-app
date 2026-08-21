/**
 * How the groove trainer names, orders and reaches a pad (roadmap DR-09/T.17).
 *
 * Labels are learner language (DESIGN.md rule 7), not the MusicXML instrument
 * names `instrumentNameOf` returns — a learner reads "Hi-hat", not "Closed
 * Hi-Hat" — and they are the pad buttons' accessible names, so they are also
 * what a screen reader announces and what an e2e spec addresses a pad by.
 *
 * Keys exist because the persona has no e-kit. The right hand owns the hi-hat
 * (J), the left the snare (F), and the right foot the kick (Space) — the same
 * hands and feet a real kit uses, so the mapping teaches something rather than
 * being arbitrary. Only the pads the trainer's own grooves use are bound; a
 * pad with no key is mouse or touch only, and the screen says so rather than
 * inventing a binding a learner would have to memorise for a groove they will
 * never meet here.
 *
 * Display order is the model's own `padOrderIndex` — bass drum first, then up
 * through the snare to the hats and cymbals. That is the order a drum staff
 * stacks its voices in, it keeps the closed hat above the open one rather than
 * below it, and it is one ordering rather than two: a second, screen-only pad
 * order would be a thing to keep in sync for no musical reason.
 */
import { padOrderIndex, type DrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'

export const GROOVE_PAD_LABEL: Readonly<Record<DrumPad, string>> = {
  kick: 'Kick',
  hhPedal: 'Hi-hat pedal',
  tomFloor: 'Floor tom',
  tomMid: 'Mid tom',
  snare: 'Snare',
  snareRim: 'Rim shot',
  crossStick: 'Cross stick',
  tomHigh: 'High tom',
  hhClosed: 'Hi-hat',
  hhOpen: 'Open hi-hat',
  rideBow: 'Ride',
  rideBell: 'Ride bell',
  rideEdge: 'Ride edge',
  crash1: 'Crash',
  crash2: 'Second crash',
  splash: 'Splash',
  unmapped: 'Unknown pad',
}

/** The `KeyboardEvent.key` that plays a pad, lower-cased. `' '` is the space bar. */
export const GROOVE_PAD_KEY: Partial<Readonly<Record<MappedDrumPad, string>>> = {
  hhClosed: 'j',
  hhOpen: 'k',
  snare: 'f',
  kick: ' ',
}

/** How a key reads on screen. */
export function keyLabel(key: string): string {
  return key === ' ' ? 'Space' : key.toUpperCase()
}

/** Sort `pads` into trainer display order — see the module comment. */
export function sortPadsForDisplay<T>(items: readonly T[], padOf: (item: T) => DrumPad): T[] {
  return [...items].sort((a, b) => padOrderIndex(padOf(a)) - padOrderIndex(padOf(b)))
}
