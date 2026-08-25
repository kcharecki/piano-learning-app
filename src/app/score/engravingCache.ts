/**
 * The engraving cache — see the big doc comment below. Split out of
 * `osmdEngraver.ts` purely so each file stays under its line budget: this is
 * the "keep an expensive engraving alive across unmounts" concept, and
 * nothing else.
 *
 * Type-only imports from `osmdEngraver.ts`, so there is no runtime cycle
 * between the two: the engraver imports these functions, this file imports
 * only its types.
 */
import type { Score } from '@core/notation/score.ts'
import type { ScoreChrome } from './engraver.ts'
import type { ScorePresentation } from './osmdEngraver.ts'
import type { EngravedNote, OsmdLike } from './osmdSvg.ts'

/**
 * ## The engraving cache (2026-08-15 perf round)
 *
 * `ScoreViewer` builds a new engraver on every mount, and Practice is a
 * destination the learner leaves and comes back to constantly — check the
 * metronome, look something up in Lessons, come back. Each return re-parsed
 * 563KB of MusicXML and re-laid-out 102 measures from scratch: measured at
 * 933ms on the Canon in D import, all of it main-thread, all of it producing
 * the picture that was already on screen a moment earlier.
 *
 * So an engraving that was expensive to produce is not thrown away on
 * unmount. OSMD draws into a host `<div>` this file owns (never the React-
 * owned container directly), so `destroy()` can simply DETACH that host and
 * hand it back here, with the OSMD instance, the id map and the cursor's
 * onset walk still intact. The next `load()` of the same MusicXML re-attaches
 * it — no parse, no layout, no walk.
 *
 * Three rules keep this from becoming a memory or staleness problem:
 *
 * 1. **Only what was expensive gets cached.** An entry is kept only if its
 *    score has at least `MIN_CACHEABLE_NOTES` notes. Short generated
 *    exercises (sight-reading, lesson diagrams, the theory reference staves)
 *    are one or two orders of magnitude below that, so they never enter the
 *    cache and — importantly — never EVICT the one entry that matters. Note
 *    count rather than the measured engrave time: engrave cost is dominated
 *    by how much music there is, and a count is a deterministic property of
 *    the score, so the caching decision is the same on a fast machine, a slow
 *    one, and in a test.
 * 2. **Two entries, LRU.** Enough for "the piece I am practising" plus one
 *    other; an evicted entry is `clear()`ed properly, not merely dropped.
 * 3. **An entry in use is never handed to a second engraver.** Two live
 *    `ScoreViewer`s showing the same score each get their own engraving; the
 *    cache only ever hands back an entry whose owner has been destroyed.
 *
 * Reuse is keyed on the MusicXML text plus everything that changes how it is
 * ENGRAVED (presentation and title chrome, the OSMD constructor options) and
 * on the `Score` the id map was built against — a different `Score` object
 * means different `ScoreNote.id`s, so its map would be wrong.
 */
export type EngravingCacheEntry = {
  readonly key: string
  readonly score: Score
  /** The element OSMD rendered into. Detached while cached, re-attached on reuse. */
  readonly host: HTMLElement
  readonly instance: OsmdLike
  readonly noteById: Map<string, EngravedNote>
  readonly onsetTicks: readonly number[]
  /** Container width the current layout was engraved at — a reuse at a
   *  different width has to re-engrave. */
  width: number
  /** Ids the last owner had coloured or hidden, so the next one can reset
   *  exactly those and no others. */
  paintedIds: ReadonlySet<string>
  /** True between `load()` handing this out and the owner's `destroy()`. */
  inUse: boolean
}


/**
 * Scores smaller than this are not worth caching — see the cache doc comment.
 * For scale: the bundled Twinkle sample is 62 notes, a sight-reading drill or
 * a lesson diagram fewer still, and the Canon in D import this cache exists
 * for is 1603.
 */
export const MIN_CACHEABLE_NOTES = 200
/** How many engravings are held at once. See the cache doc comment. */
export const MAX_CACHED_ENGRAVINGS = 2

const engravingCache = new Map<string, EngravingCacheEntry>()

/** Everything that changes what the engraving looks like, as one string. */
export function engravingCacheKey(
  musicXml: string,
  presentation: ScorePresentation,
  chrome: ScoreChrome | undefined,
): string {
  return `${presentation}|${String(chrome?.title)}|${musicXml}`
}

/**
 * The cached engraving for this key, marked in use — or `undefined` when
 * there is none, it belongs to a different `Score`, or it is still owned by a
 * live engraver. Re-inserts on a hit so `Map` insertion order stays LRU.
 */
export function takeCachedEngraving(key: string, score: Score): EngravingCacheEntry | undefined {
  const entry = engravingCache.get(key)
  if (entry === undefined || entry.inUse || entry.score !== score) return undefined
  entry.inUse = true
  engravingCache.delete(key)
  engravingCache.set(key, entry)
  return entry
}

/** Stores `entry`, evicting the least-recently-used FREE entry past the cap. */
export function putCachedEngraving(entry: EngravingCacheEntry): void {
  engravingCache.delete(entry.key)
  engravingCache.set(entry.key, entry)
  for (const [key, cached] of engravingCache) {
    if (engravingCache.size <= MAX_CACHED_ENGRAVINGS) break
    if (cached.inUse) continue
    cached.instance.clear()
    cached.host.remove()
    engravingCache.delete(key)
  }
}

/**
 * Drops every cached engraving, clearing each OSMD instance. Exists for tests
 * — nothing in the app ever wants a cold cache mid-session — so that one
 * spec's engraving can never be handed to another's.
 *
 * @public knip: consumed only by tests, which production mode does not see.
 */
export function clearEngravingCache(): void {
  for (const entry of engravingCache.values()) {
    entry.instance.clear()
    entry.host.remove()
  }
  engravingCache.clear()
}
