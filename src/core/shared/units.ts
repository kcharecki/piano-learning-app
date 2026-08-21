/**
 * Unit discipline for the domain.
 *
 * Two rules, both learned the hard way in music software:
 *  - pitch is always a MIDI note number inside the core (60 = middle C);
 *  - musical time is always ticks inside the core, never milliseconds.
 *
 * Branded types make a `Ticks` value impossible to pass where `Millis` is
 * expected, which is the single most common bug class in this kind of app.
 */
declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

/** Musical time. `TICKS_PER_QUARTER` ticks to a quarter note, tempo-independent. */
export type Ticks = Brand<number, 'Ticks'>
/** Wall-clock time in milliseconds. Only meaningful with a tempo map. */
export type Millis = Brand<number, 'Millis'>
/** MIDI note number, 0–127. 60 = middle C (C4). */
export type Midi = Brand<number, 'Midi'>
/** Beats per minute, referring to the quarter note unless stated otherwise. */
export type Bpm = Brand<number, 'Bpm'>

/**
 * 480 is the de-facto standard MIDI resolution and divides cleanly by 2, 3, 4,
 * 5, 6 and 8 — so triplets, quintuplets and 32nd notes are all exact integers.
 */
export const TICKS_PER_QUARTER = 480

export const ticks = (n: number): Ticks => n as Ticks
export const millis = (n: number): Millis => n as Millis
export const bpm = (n: number): Bpm => n as Bpm

/** Lowest and highest MIDI notes an 88-key piano produces (A0–C8). */
export const PIANO_LOWEST_MIDI = 21
export const PIANO_HIGHEST_MIDI = 108

export const isValidMidi = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 127

/** Construct a Midi, throwing on an out-of-range value (programmer error). */
export function midi(n: number): Midi {
  if (!isValidMidi(n)) throw new RangeError(`invalid MIDI note number: ${n}`)
  return n as Midi
}

/** Note-value helpers, expressed in ticks. */
export const WHOLE = ticks(TICKS_PER_QUARTER * 4)
export const HALF = ticks(TICKS_PER_QUARTER * 2)
export const QUARTER = ticks(TICKS_PER_QUARTER)
export const EIGHTH = ticks(TICKS_PER_QUARTER / 2)
/**
 * One note of an eighth-note triplet: three in the time of a quarter. Exact
 * because 480 divides by 3 — see the `TICKS_PER_QUARTER` note above. A note of
 * this length is an EIGHTH as written; only its `Tuplet` ratio says so, since
 * by raw duration it would engrave as a 16th.
 */
export const TRIPLET_EIGHTH = ticks(TICKS_PER_QUARTER / 3)
export const SIXTEENTH = ticks(TICKS_PER_QUARTER / 4)

export const addTicks = (a: Ticks, b: Ticks): Ticks => ticks(a + b)
