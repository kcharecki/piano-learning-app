import type { Page } from '@playwright/test'

/**
 * A paced driver for the Groove trainer's on-screen pads.
 *
 * Timing this drill from the Playwright side does not work: every
 * `locator.click()` is a CDP round trip, so 24 hits accumulate host-scheduler
 * jitter against a grading window measured in tens of milliseconds. The
 * alternative that some codebases reach for — a `window.__test` hook the app
 * ships in production so a spec can inject hit times — is worse: it means the
 * spec never exercises the path the learner uses.
 *
 * So this driver does neither. It runs *inside the page*, dispatches real
 * `pointerdown` events at the real pad buttons (the same events a mouse
 * produces, minus `isTrusted`), and schedules them with `setTimeout` against
 * absolute targets taken from one shared origin. Nothing test-only is added to
 * the app; the only page-side state is created by this file, at drive time.
 *
 * ## How the origin is found
 *
 * The graded window opens when the count-in ends, and the app announces that
 * by putting "Playing" in its run-state live region. Polling for that text
 * costs up to a frame of lag *per poll interval*; a `MutationObserver` fires
 * as a microtask on the same commit, so the origin is off by at most the
 * distance from the app's own timer callback to React's commit. Every hit is
 * then scheduled absolutely from that origin, so error does not accumulate
 * across the run.
 *
 * `playGrooveHits` returns what it actually did — target and observed instant
 * for every hit — so a spec can prove the *driver* was accurate before it
 * blames the app for an offset. If the harness drifted, the spec should fail
 * on the harness, loudly, rather than quietly reporting the drift as the
 * learner's timing.
 */

/** The three pads this driver can hit, keyed the way a spec wants to read. */
export type DrumPadKey = 'hihat' | 'openhat' | 'snare' | 'kick'

/** Accessible names of the pad buttons, as rendered by the Groove screen. */
const PAD_LABEL: Readonly<Record<DrumPadKey, string>> = {
  hihat: 'Hi-hat',
  // Its own pad, not a mode of the closed hat: the grader times every pad
  // separately, so a groove that opens the hat has four rows, not three.
  openhat: 'Open hi-hat',
  snare: 'Snare',
  kick: 'Kick',
}

/** One hit: which pad, and how long after the graded window opened. */
export interface TimedHit {
  readonly pad: DrumPadKey
  readonly ms: number
}

/** What the driver observed for one hit, in page time. */
export interface DispatchedHit {
  readonly pad: DrumPadKey
  readonly targetMs: number
  readonly actualMs: number
}

/**
 * Click Start, wait for the graded window, then hit the pads at `hits`.
 *
 * `startName` is the accessible name of the button that begins the run;
 * `hits` need not be sorted. Resolves once the last hit has been dispatched
 * and a short tail has elapsed, so the caller can go straight to asserting
 * the verdict.
 */
export async function playGrooveHits(
  page: Page,
  hits: readonly TimedHit[],
  startName = 'Start',
): Promise<DispatchedHit[]> {
  return page.evaluate(
    async ({ hits, startName, padLabel }): Promise<DispatchedHit[]> => {
      const button = (name: string): HTMLButtonElement => {
        const el = document.querySelector(`button[aria-label="${name}"]`)
        if (!(el instanceof HTMLButtonElement)) {
          throw new Error(`drum-pads: no button with accessible name "${name}" on this screen`)
        }
        return el
      }

      const runStateText = (): string => {
        const el = document.querySelector('[role="status"][aria-label="Run state"]')
        return el?.textContent ?? ''
      }

      // Armed BEFORE Start, so a very short count-in cannot open and be
      // missed between the click and the observer being attached. The whole
      // body is observed, not the live region itself, because React may
      // replace that node rather than mutate its text.
      const graded: Promise<number> = new Promise((resolve, reject) => {
        const settle = (): boolean => {
          if (!runStateText().startsWith('Playing')) return false
          observer.disconnect()
          clearTimeout(bail)
          resolve(performance.now())
          return true
        }
        const observer = new MutationObserver(settle)
        const bail = setTimeout(() => {
          observer.disconnect()
          reject(new Error(`drum-pads: graded window never opened; run state was "${runStateText()}"`))
        }, 30_000)
        observer.observe(document.body, { childList: true, characterData: true, subtree: true })
        settle()
      })

      button(startName).click()
      const origin = await graded

      const dispatched: DispatchedHit[] = []
      const ordered = [...hits].sort((a, b) => a.ms - b.ms)
      const pending = ordered.map(
        (hit) =>
          new Promise<void>((resolve) => {
            const fire = (): void => {
              button(padLabel[hit.pad]).dispatchEvent(
                new PointerEvent('pointerdown', {
                  bubbles: true,
                  cancelable: true,
                  button: 0,
                  pointerId: 1,
                  pointerType: 'mouse',
                  isPrimary: true,
                }),
              )
              dispatched.push({ pad: hit.pad, targetMs: hit.ms, actualMs: performance.now() - origin })
              resolve()
            }
            const delay = origin + hit.ms - performance.now()
            if (delay <= 0) fire()
            else setTimeout(fire, delay)
          }),
      )

      await Promise.all(pending)
      // A short tail so the app's own end-of-run transition has landed by the
      // time the caller starts asserting.
      await new Promise((resolve) => setTimeout(resolve, 250))
      return dispatched
    },
    { hits: [...hits], startName, padLabel: PAD_LABEL },
  )
}

/** The largest gap between a hit's target instant and when it was dispatched. */
export function worstDriverDriftMs(dispatched: readonly DispatchedHit[]): number {
  return dispatched.reduce((worst, hit) => Math.max(worst, Math.abs(hit.actualMs - hit.targetMs)), 0)
}
