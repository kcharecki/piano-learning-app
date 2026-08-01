# Architecture

## Why this shape

The requirements have two properties that dominate the design:

1. **Almost all of the value is logic, not pixels.** Interval spelling, key signatures, note
   matching against a score, SRS scheduling, sight-reading generation, level advancement — these
   are pure functions over data. They are also the parts that are easy to get subtly wrong.
2. **Latency budgets are tight** (REQ-4.1: <20 ms audio, <100 ms visual). That means the hot path
   must be free of framework overhead and must be measurable in isolation.

Both push the same way: put everything in a **pure, dependency-free domain core** and keep the
browser at arm's length behind narrow ports. The payoff is that the entire test suite for the
interesting behaviour runs in Node in well under a second, with no jsdom, no canvas, no fake MIDI
device, and no flake.

## Layers

```
┌───────────────────────────────────────────────────────────┐
│ src/app          React components, screens, stores        │  UI
├───────────────────────────────────────────────────────────┤
│ src/adapters     WebMidiInput, WebAudioOutput, IdbStore,  │  impure edge
│                  OsmdRenderer, SystemClock, SeededRng     │
├───────────────────────────────────────────────────────────┤
│ src/core         theory · notation · timing · practice ·  │  pure domain
│                  srs · curriculum · progress · generator  │
│                  + ports/ (interfaces the adapters fill)  │
├───────────────────────────────────────────────────────────┤
│ src/content      lessons, curriculum data, MusicXML       │  data
└───────────────────────────────────────────────────────────┘
```

Dependencies point **downward only**. `src/core` imports nothing outside `src/core`.

## Ports (dependency inversion)

`src/core/ports/` declares the interfaces the domain needs from the outside world:

| Port | Real implementation | Test implementation |
|------|--------------------|---------------------|
| `Clock` | `performance.now()` | `FakeClock` — manual tick advance |
| `Rng` | seeded xorshift | same seeded xorshift, fixed seed |
| `MidiInput` | Web MIDI API | `FakeMidiInput` — script note events |
| `AudioOutput` | Web Audio + soundfont / MIDI out | `RecordingAudioOutput` — asserts on calls |
| `Store` | IndexedDB via `idb` | in-memory map |

Because `Clock` and `Rng` are injected, every timing- and generation-dependent behaviour is
deterministic under test. There are no `await sleep(100)` calls anywhere in the suite.

## Core modules

| Module | Status | Responsibility | Key requirements |
|--------|--------|---------------|------------------|
| `core/theory` | built | pitch, intervals, scales, keys, chords, chord recognition | REQ-3.5.x |
| `core/notation` | built | MusicXML/MIDI parse → internal `Score` model; tick timeline | REQ-3.2.1, 3.2.5 |
| `core/timing` | built | transport, metronome, tempo mapping, tick↔ms | REQ-3.9.1, 4.1 |
| `core/practice` | built | note matcher, wait mode | REQ-3.3.x |
| `core/generator` | planned | parameterised sight-reading generation | REQ-3.4.2, 5.3 |
| `core/srs` | planned | shared spaced-repetition scheduler | REQ-3.9.4 |
| `core/curriculum` | planned | levels, units, lessons, exit criteria, session builder | REQ-3.1.x, 2.x |
| `core/progress` | planned | practice log, trends, level advancement, export | REQ-3.10.x |

Each module is a directory of implementation files with co-located `*.test.ts`. Only `core/ports`
has an `index.ts` barrel; the rest are imported by file, which keeps the import graph legible.

## The internal score model

MusicXML is parsed once, at import, into a flat, tick-indexed structure that is cheap to scan
during playback:

```ts
type Score = {
  meta: { title, composer, divisions }
  parts: Part[]            // usually 2: right hand, left hand
  measures: Measure[]      // start tick, time sig, key sig
  notes: ScoreNote[]       // sorted by startTick — the playback/matching timeline
}
type ScoreNote = {
  midi: number; startTick: number; durationTicks: number
  hand: 'left' | 'right'; voice: number; measureIndex: number
  tied: boolean; fingering?: number
}
```

Note matching walks a window over `notes` rather than re-querying the notation library, which is
what keeps feedback inside the 100 ms budget and makes the matcher trivially unit-testable.

## Audio strategy (REQ-4.7)

Preference order at runtime:
1. **MIDI out to the connected digital piano** — zero synthesis latency, best sound.
2. **Web Audio + sampled soundfont** — fallback when no output device is available.

**`AudioOutput` is the only sound port the domain may use.** `MidiOutput` (in `core/ports/midi.ts`)
is *not* a second domain port and domain code must not import it — it is the interface the MIDI-out
implementation of `AudioOutput` is written against, declared next to `MidiInput` because the two
describe the same device. If it ever grows a domain caller, that is a design mistake, not a feature.

`MidiInput`, by contrast, genuinely is a domain port: the matcher and wait mode consume its events.

## Testing strategy

- **core** (`npm test`) — node, no DOM, ~ms per file. This is where correctness lives.
- **property tests** — `fast-check` for algebraic laws: `transpose(transpose(n, i), -i) === n`,
  interval inversion, enharmonic round-trips, scheduler ordering, SRS monotonicity.
- **golden tests** — small MusicXML fixtures parsed and snapshotted, so parser changes are visible.
- **ui** (`npm run test:ui`) — happy-dom, render + wiring only.
- **e2e** (`npm run test:e2e`) — Playwright smoke: app boots, screens reachable.
