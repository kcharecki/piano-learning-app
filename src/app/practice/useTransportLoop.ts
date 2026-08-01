/**
 * The pump (roadmap 1.18): the ONE place per-frame work happens. Everything
 * else in `src/app/practice` is declarative — this hook is what turns "the
 * transport is playing" into a running loop, and it is deliberately small so
 * the loop itself, not the domain it drives, is what gets tested here.
 *
 * The driver is injectable: `rafFrameDriver` for the browser, a manual driver
 * for tests. `requestAnimationFrame` does not run in every test environment,
 * and even where it does, a test should not depend on real frame timing — so
 * this hook never calls it directly. A test passes a fake driver and pumps by
 * invoking its captured callback by hand.
 *
 * `onFrame` is read through a ref that is refreshed on every render, so the
 * loop always calls the latest closure — a stale `onFrame` capturing an old
 * score or an old audio output is exactly the class of bug this exists to
 * avoid. That means the effect below only needs to resubscribe when `active`
 * or `driver` change, never when the caller's state does.
 */
import { useEffect, useRef } from 'react'

/** Schedules `callback` to run repeatedly (about once per frame); returns a canceller. */
export type FrameDriver = (callback: () => void) => () => void

/** The real browser driver: `requestAnimationFrame`, re-armed after every call. */
const rafFrameDriver: FrameDriver = (callback) => {
  let handle = requestAnimationFrame(function loop() {
    callback()
    handle = requestAnimationFrame(loop)
  })
  return () => cancelAnimationFrame(handle)
}

export type UseTransportLoopOptions = {
  /** Whether the loop should be running right now (e.g. the transport is playing or waiting). */
  readonly active: boolean
  /** Called once per frame while `active`. */
  readonly onFrame: () => void
  /** Injection seam for tests. Defaults to `rafFrameDriver`. */
  readonly driver?: FrameDriver
}

/** Drives `onFrame` from `driver` while, and only while, `active` is true. */
export function useTransportLoop({
  active,
  onFrame,
  driver = rafFrameDriver,
}: UseTransportLoopOptions): void {
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!active) return undefined
    return driver(() => onFrameRef.current())
  }, [active, driver])
}
