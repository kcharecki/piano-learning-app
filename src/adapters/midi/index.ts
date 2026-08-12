export { createWebMidi } from './webmidi.ts'
export type { WebMidi } from './webmidi.ts'
export { isWebMidiSupported } from './capability.ts'
// The two BLE UUID constants are deliberately NOT re-exported here: they are
// implementation detail of `blemidi.ts`'s own GATT lookup and its tests, and a
// barrel export nothing imports is what `knip` fails the build over.
export { connectBluetoothMidi, isWebBluetoothSupported } from './blemidi.ts'
export type { BluetoothMidi } from './blemidi.ts'
