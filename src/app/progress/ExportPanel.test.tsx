/**
 * `ExportPanel` tests (roadmap 4.6a): the download buttons produce a Blob
 * that round-trips through `@core/progress/export.ts`'s own parser back to
 * the current snapshot, the object URL is always revoked, a corrupt file
 * shows the parser's readable error and leaves every store untouched, and a
 * valid file is held for confirmation — never applied — until the learner
 * clicks "Replace my progress".
 */
import { useProgressStore, type StoredAssessment } from '@app/state/progressStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { MIN_LEVEL as SIGHT_READING_MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { exportCsv, exportJson, importProgress, type ProgressSnapshot } from '@core/progress/export.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { FakeClock } from '@test/fakes.ts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportPanel } from './ExportPanel.tsx'
import { gatherProgressSnapshot, SIGHT_READING_LEVEL_KEY } from './snapshot.ts'

function resetStores(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useTechniqueStore.setState({ attempts: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useSightReadingStore.setState({ level: SIGHT_READING_MIN_LEVEL, history: [] })
}

const existingCard: Card = {
  id: 'staff-to-key-64',
  due: 5_000,
  intervalDays: 3,
  ease: 2.5,
  reps: 4,
  lapses: 1,
  introducedAt: 100,
}

const importedCard: Card = {
  id: 'imported-card',
  due: 1,
  intervalDays: 1,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  introducedAt: 0,
}

const existingPracticeEntry: PracticeEntry = {
  id: 'pe-existing',
  startedAt: 1_000,
  endedAt: 1_500,
  kind: 'repertoire',
  itemName: 'Minuet in G',
  itemId: 'score-1',
  tempoBpm: 90,
  accuracy: 0.87,
  note: 'felt good',
}

const existingAssessment: StoredAssessment = {
  id: 'assess-existing',
  scoreId: 'score-1',
  scoreTitle: 'Minuet in G',
  at: 3_000,
  result: {
    scoreId: 'score-1',
    accuracy: 0.93,
    timingConsistency: 0.8,
    meanAbsDeviationMs: 12,
    tempoBpm: 100,
    measures: [],
    counts: { correct: 4, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt: 3_000,
  },
}

function seedStores(): void {
  useFlashcardStore.getState().upsertCard(existingCard)
  useSightReadingStore.getState().setLevel(3)
  useProgressStore.getState().addPracticeEntry(existingPracticeEntry)
  useProgressStore.getState().addAssessment(existingAssessment)
}

function importableSnapshot(): ProgressSnapshot {
  return {
    version: 1,
    exportedAt: 500,
    practiceEntries: [],
    srsCards: [importedCard],
    sightReadingHistory: [],
    levels: { [SIGHT_READING_LEVEL_KEY]: 2 },
    repertoire: [],
    assessments: [],
    techniqueAttempts: [],
  }
}

function getFileInput(): HTMLInputElement {
  return screen.getByLabelText(/restore from a file/i) as HTMLInputElement
}

/** Stubs the Blob-download path so a test can inspect what would have been saved. */
function stubDownload(): { blobs: Blob[]; revoked: string[]; clicks: HTMLAnchorElement[] } {
  const blobs: Blob[] = []
  const revoked: string[] = []
  const clicks: HTMLAnchorElement[] = []
  let counter = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
    blobs.push(obj as Blob)
    counter += 1
    return `blob:mock-${counter}`
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url)
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this)
  })
  return { blobs, revoked, clicks }
}

beforeEach(() => {
  resetStores()
  seedStores()
})

describe('ExportPanel downloads', () => {
  it('downloads a JSON blob matching the seeded stores exactly, via a real appended+clicked anchor, then revokes the URL', async () => {
    const clock = new FakeClock(12_345)
    const { blobs, revoked, clicks } = stubDownload()
    const user = userEvent.setup()
    render(<ExportPanel date={clock} />)

    await user.click(screen.getByRole('button', { name: /download json/i }))

    expect(clicks).toHaveLength(1)
    expect(clicks[0]?.download).toBe('piano-progress.json')

    const [blob] = blobs
    if (blob === undefined) throw new Error('no blob captured')
    const text = await blob.text()
    const parsed = importProgress(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value).toEqual({
        version: 1,
        exportedAt: 12_345,
        practiceEntries: [existingPracticeEntry],
        srsCards: [existingCard],
        sightReadingHistory: [],
        levels: { [SIGHT_READING_LEVEL_KEY]: 3 },
        repertoire: [],
        techniqueAttempts: [],
        assessments: [
          {
            id: existingAssessment.id,
            at: existingAssessment.at,
            accuracy: existingAssessment.result.accuracy,
            kind: existingAssessment.scoreTitle,
            itemId: existingAssessment.scoreId,
          },
        ],
      })
    }
    await waitFor(() => expect(revoked).toHaveLength(1))
    expect(await screen.findByRole('status')).toHaveTextContent(/downloaded piano-progress\.json/i)
  })

  it('downloads a CSV zip whose entries match exportCsv, via a real appended+clicked anchor, then revokes the URL', async () => {
    const clock = new FakeClock(0)
    const { blobs, revoked, clicks } = stubDownload()
    const user = userEvent.setup()
    render(<ExportPanel date={clock} />)

    await user.click(screen.getByRole('button', { name: /download csv/i }))

    expect(clicks).toHaveLength(1)
    expect(clicks[0]?.download).toBe('piano-progress-csv.zip')

    const [blob] = blobs
    if (blob === undefined) throw new Error('no blob captured')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const entries = unzipSync(bytes)
    const decoder = new TextDecoder()
    const expectedBundle = exportCsv(gatherProgressSnapshot(clock))
    for (const [name, csv] of Object.entries(expectedBundle)) {
      const entryBytes = entries[`${name}.csv`]
      expect(entryBytes).toBeDefined()
      if (entryBytes === undefined) throw new Error(`missing zip entry ${name}.csv`)
      expect(decoder.decode(entryBytes)).toBe(csv)
    }
    await waitFor(() => expect(revoked).toHaveLength(1))
  })
})

describe('ExportPanel restore', () => {
  it('shows the parser error for a corrupt file and leaves the stores untouched', async () => {
    const user = userEvent.setup()
    render(<ExportPanel />)
    const file = new File(['not json'], 'broken.json', { type: 'application/json' })

    await user.upload(getFileInput(), file)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/broken\.json/)
    expect(alert.textContent).toMatch(/invalid JSON/i)
    expect(useFlashcardStore.getState().cardsById).toEqual({ [existingCard.id]: existingCard })
    expect(useSightReadingStore.getState().level).toBe(3)
    expect(screen.queryByRole('group', { name: /confirm restore/i })).toBeNull()
  })

  it('holds a valid file for confirmation without applying it, and Cancel discards it untouched', async () => {
    const user = userEvent.setup()
    const file = new File([exportJson(importableSnapshot())], 'export.json', {
      type: 'application/json',
    })
    render(<ExportPanel />)

    await user.upload(getFileInput(), file)

    await screen.findByRole('group', { name: /confirm restore/i })
    expect(screen.getByText(/REPLACE all current progress/i)).toBeInTheDocument()
    // Not applied yet.
    expect(useFlashcardStore.getState().cardsById).toEqual({ [existingCard.id]: existingCard })

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByRole('group', { name: /confirm restore/i })).toBeNull()
    expect(useFlashcardStore.getState().cardsById).toEqual({ [existingCard.id]: existingCard })
  })

  it('replaces progress with the imported snapshot only after "Replace my progress" is clicked', async () => {
    const user = userEvent.setup()
    const file = new File([exportJson(importableSnapshot())], 'export.json', {
      type: 'application/json',
    })
    render(<ExportPanel />)

    await user.upload(getFileInput(), file)
    await screen.findByRole('group', { name: /confirm restore/i })

    await user.click(screen.getByRole('button', { name: /replace my progress/i }))

    await waitFor(() => {
      expect(useFlashcardStore.getState().cardsById).toEqual({ [importedCard.id]: importedCard })
    })
    expect(useSightReadingStore.getState().level).toBe(2)
    expect(screen.getByRole('status')).toHaveTextContent(/restored progress/i)
    expect(screen.queryByRole('group', { name: /confirm restore/i })).toBeNull()
  })
})
