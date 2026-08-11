import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.39: the shell's default landing destination is
 * Today, not Practice — Practice used to open on the bundled sample piece
 * with 30 controls below it, the most intimidating screen in the app, as
 * the very first thing a learner ever saw.
 *
 * The roadmap's own proof action calls out "asserted... against a fresh
 * profile, not a warm one" specifically: this app's persistence
 * (`@app/state/persistence.ts`) never stores which screen was open, so a
 * warm IndexedDB profile would not by itself hide a regression here — but
 * asserting against a profile this test itself wipes first is the only way
 * to be sure the default is really "nothing to restore, land on Today", not
 * an accident of whatever a previous run happened to leave behind (a stale
 * dev-server IndexedDB from manual testing, another spec file's data, …).
 * Playwright already isolates browser contexts per test, but this test does
 * not rely on that alone — it wipes IndexedDB itself before the boot it
 * actually asserts on.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Deletes every IndexedDB database this origin holds, so the next load is a
 * genuinely fresh profile rather than whatever this worker's context already
 * had lying around. */
async function wipeIndexedDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve, reject) => {
            if (db.name === undefined) {
              resolve()
              return
            }
            const req = indexedDB.deleteDatabase(db.name)
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error as Error)
            req.onblocked = () => resolve()
          }),
      ),
    )
  })
}

test('a cold boot with an empty IndexedDB lands on Today, not Practice (roadmap 5.39)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  // A first goto is needed before IndexedDB can be reached from page context
  // at all; wipe, then reload — the reload is the actual "cold boot" this
  // test asserts on.
  await page.goto('/')
  await wipeIndexedDb(page)
  await page.reload()

  await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  // The densest screen in the app must NOT be what a first-ever learner sees.
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toHaveCount(0)

  // The root path resolves to Today's own URL (roadmap 5.42) — not left on
  // the bare `/` a stale bookmark or share link could point at forever.
  expect(new URL(page.url()).pathname).toBe('/today')

  expect(errors).toEqual([])
})
