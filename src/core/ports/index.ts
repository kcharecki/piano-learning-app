export type { Clock, DateSource, Scheduler } from './clock.ts'
export type { Rng } from './rng.ts'
export type {
  MidiEvent,
  MidiNoteOn,
  MidiNoteOff,
  MidiSustain,
  MidiDevice,
  MidiInput,
  MidiOutput,
  Unsubscribe,
} from './midi.ts'
export type { AudioOutput } from './audio.ts'
export type { Store, CollectionName } from './store.ts'

// This barrel carries TYPES only. The value exports (seededRng, COLLECTIONS,
// and friends) are imported from their own module by the handful of callers
// that need them — re-exporting them here just produced a second, unused path
// to the same thing, which knip duly reported as dead.
