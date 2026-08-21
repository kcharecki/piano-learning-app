/**
 * The one write path every persisted slice goes through (roadmap 5.x
 * persistence, follow-up F.2) — extracted from `persistence.ts` because it is
 * a self-contained concept: it knows a `Store`, a collection and a key, and
 * nothing at all about slices, stores or restore. `persistence.ts` owns which
 * slice is written when; this owns the ordering guarantee that makes any of
 * those writes safe.
 */
import type { Store } from '@core/ports/index.ts'

/**
 * Writes are last-write-wins WITHOUT relying on the underlying store to keep
 * concurrent `put`s in completion order — a real store's write latency can
 * vary, so an earlier `put` can resolve after a later one. The fix is to
 * never let that race exist: at most one `put` to (`collection`, `key`) is
 * ever in flight. `seq` is bumped on every call and stamped onto `pending`
 * alongside the value, so `pending` always names both the newest value
 * produced and the sequence number it belongs to. A value that arrives
 * mid-write replaces `pending` — the value it superseded is dropped, never
 * written — instead of starting a second `put`. When the in-flight write
 * settles, the drain loop checks `pending.seq`: if it is still the one that
 * write just sent (nothing queued while it was in flight), draining stops;
 * otherwise it is a genuinely newer value and gets sent next. Either way the
 * store only ever receives writes in the order the values were produced, so
 * a `put` that resolves late is, by construction, the one that was started
 * last — there is no completion to drop, because there was never a newer one
 * still in flight behind it. A rejected `put` is swallowed here, never
 * thrown into React.
 *
 * The returned function also carries a `flush()` (roadmap follow-up F.2):
 * a synchronous, best-effort drain of whatever is currently sitting in
 * `pending`, for `startPersisting`'s page-hide listener to call on every
 * slice. See the module comment's "Page-hide flush" and "Why flushing is
 * safe against the ordering invariant" sections for the full reasoning —
 * `flush` never issues a `put` for a value already sent, and the `put` it
 * does issue is always created strictly after whichever write is currently
 * in flight, so IndexedDB's creation-order guarantee still lands them in
 * the right order.
 */
export type FlushableWrite<T> = {
  (value: T): void
  /** Best-effort, synchronous, never awaited — see the module comment. */
  readonly flush: () => void
}

export function createWriteQueue<T>(store: Store, collection: string, key: string): FlushableWrite<T> {
  let pending: { readonly seq: number; readonly value: T } | undefined
  let seq = 0
  let draining = false
  // The `seq` of the value whose `put` is CURRENTLY outstanding, if any —
  // distinct from `pending` itself, which (see the loop below) stays defined
  // for the value's WHOLE time in flight and is only cleared once its `put`
  // settles with nothing newer behind it. `flush` needs to tell "`pending`
  // IS the value already handed to `store.put`" apart from "`pending` is a
  // newer value stuck behind that one" — comparing against this is how.
  let inFlightSeq: number | undefined

  const drain = (): void => {
    if (draining) return
    draining = true
    void (async () => {
      while (pending !== undefined) {
        const { seq: sentSeq, value } = pending
        inFlightSeq = sentSeq
        try {
          await store.put(collection, key, value)
        } catch {
          // Swallowed: a failed save must not crash the practice session.
        }
        inFlightSeq = undefined
        // Stop only if nothing newer was queued while this write was in
        // flight; otherwise `pending` now names that newer value and the loop
        // sends it next. Re-read `pending` rather than relying on pre-`await`
        // narrowing: it can be cleared by other code between the `await`
        // starting and resolving.
        const current = pending
        if (current !== undefined && current.seq === sentSeq) pending = undefined
      }
      draining = false
    })()
  }

  const write = ((value: T): void => {
    seq += 1
    pending = { seq, value }
    drain()
  }) as FlushableWrite<T>

  return Object.assign(write, {
    flush: (): void => {
      // Nothing queued at all: either nothing was ever written, or an
      // earlier `flush()` already sent the newest value and nothing has
      // changed since. Nothing to do.
      if (pending === undefined) return
      // `pending` names the value CURRENTLY being sent by the drain loop's
      // own in-flight `put` — not a newer one stuck behind it. Sending it
      // again would be the exact duplicate `put` this function must never
      // issue; the drain loop already owns delivering this one.
      if (pending.seq === inFlightSeq) return
      const { value } = pending
      // Clear BEFORE issuing the put, not after: this is what stops the
      // drain loop's in-flight write from resending this same value once it
      // settles (its post-await check reads `pending`, and finds it empty),
      // and what makes a second `flush()` call — another lifecycle event
      // for the same hide, or a later hide/show cycle — a no-op.
      pending = undefined
      void store.put(collection, key, value).catch(() => {
        // Swallowed, same as the drain loop above: a failed save at
        // page-hide has no one left to report it to.
      })
    },
  })
}
