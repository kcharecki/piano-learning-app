import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { techniqueLibrary, techniqueScore } from '../src/core/technique/library.ts'

/**
 * E2E proof for roadmap 5.23's second half: the posture-prompt banner is
 * really wired into the screen, not just present in `useTechniqueDrill`'s
 * return type. The SCHEDULE itself (fires after enough drilling time or
 * enough completed attempts, driven by the injected `Clock`, never real
 * time) is proved at the unit level in `useTechniqueDrill.test.ts` and
 * `posturePromptSchedule.test.ts` — a `FakeClock` is the only way to prove
 * "never real time" without a test that blocks for the real ten-minute
 * threshold. This spec drives the OTHER trigger — completed attempts — with
 * a real browser and the mouse-only on-screen keyboard (roadmap 5.5a),
 * since six quick attempts is fast enough for an e2e run and the attempt
 * counter does not care whether a run was accurate: `useTechniqueDrill.ts`
 * credits the posture schedule on every scored attempt, clean or not.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Mirrors `core/theory/pitch.ts`'s `midiToName` default (sharp) spelling — e2e specs stay free of `@core` label-formatting imports by design (see `e2e/practice-onscreen-keyboard.spec.ts`'s own copy of this helper). */
function noteLabel(note: number): string {
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`
}

test('six completed attempts (clean or not) surface the posture-check prompt, and acknowledging clears it (roadmap 5.23)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Technique').click()
  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()

  // No MIDI installed in this spec — the on-screen keyboard fallback
  // (roadmap 5.5a) is on by default, same seam `practice-onscreen-
  // keyboard.spec.ts` drives for the Practice screen.
  const keyboard = page.getByRole('group', { name: 'Play the score' })
  await expect(keyboard).toBeVisible()

  const drill = techniqueLibrary(1)[0]
  if (drill === undefined) throw new Error('expected at least one level-1 drill')
  const score = techniqueScore(drill, drill.targetBpm)
  const firstNote = score.notes[0]
  if (firstNote === undefined) throw new Error('expected at least one note in the level-1 drill')
  const key = keyboard.getByRole('button', { name: noteLabel(firstNote.midi) })

  await expect(page.getByTestId('technique-posture-prompt')).toHaveCount(0)

  // Six quick attempts: press one note, stop. Evenness/accuracy are
  // irrelevant to the posture schedule's attempt counter — only that a
  // scored attempt was produced (`run.onsets.length > 0`).
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await key.click()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
  }

  const prompt = page.getByTestId('technique-posture-prompt')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText(/posture|check|wrist/i)

  await prompt.getByRole('button', { name: 'I checked' }).click()
  await expect(prompt).toHaveCount(0)

  expect(errors).toEqual([])
})
