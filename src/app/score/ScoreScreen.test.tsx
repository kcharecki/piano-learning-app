/**
 * `ScoreScreen` composes import + viewer and auto-loads the bundled sample
 * score (roadmap 1.17, REQ-3.2.5, REQ-5.1). `ScoreViewer` wraps OSMD, which
 * does not run in happy-dom, so it is mocked out here — this file only
 * asserts on what ScoreScreen wires into it, not on OSMD.
 */
import sampleMusicXml from '@content/scores/twinkle-twinkle-little-star.musicxml?raw'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scoreViewerSpy = vi.fn()

vi.mock('./ScoreViewer.tsx', () => ({
  ScoreViewer: (props: { musicXml: string; score: unknown }) => {
    scoreViewerSpy(props)
    return <div data-testid="mock-score-viewer" />
  },
}))

const { ScoreScreen } = await import('./ScoreScreen.tsx')

function resetStore(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
  // `hydrated: true` because these tests exercise the LEVEL gate
  // (`MIN_ANALYSIS_THEORY_LEVEL`), not the hydration gate — that gate has
  // its own tests below, which set `hydrated: false` explicitly.
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: true })
}

/** Seeds the theory track to `level` directly, the way roadmap 3.18's unit
 *  tests are asked to: through the store, not through a UI flow (that is
 *  what e2e/round6.spec.ts is for). */
function setTheoryLevel(level: number): void {
  const current = useLevelStore.getState().levelState
  useLevelStore.setState({
    levelState: { ...current, levels: { ...current.levels, theory: level } },
  })
}

beforeEach(() => {
  resetStore()
  scoreViewerSpy.mockClear()
})
afterEach(() => {
  cleanup()
  resetStore()
})

describe('ScoreScreen', () => {
  it('auto-loads the bundled sample score and hands it to the viewer', async () => {
    render(<ScoreScreen />)

    await screen.findByText('Twinkle, Twinkle, Little Star')
    // Assert WHAT reaches the viewer, not how many times it renders: the screen
    // now nests the viewer inside PracticeScreen, whose state settles over a
    // few renders. A render count would pin React's scheduling, not behaviour.
    await waitFor(() => expect(scoreViewerSpy).toHaveBeenCalled())
    for (const [props] of scoreViewerSpy.mock.calls as [{ musicXml: string; score: unknown }][]) {
      expect(props.musicXml).toBe(sampleMusicXml)
      expect(props.score).toBeDefined()
    }
    expect(useScoreStore.getState().loaded?.sourceName).toContain('bundled sample')
  })

  // UI-09 (2026-08-12 UI audit): the raw file input used to be the FIRST
  // thing on screen. It now lives in a popover opened from "Change piece…" —
  // never rendered open on its own.
  it('names the piece in a page header, and keeps the import panel behind "Change piece…" until asked for', async () => {
    const user = userEvent.setup()
    render(<ScoreScreen />)
    await screen.findByText('Twinkle, Twinkle, Little Star')

    // The title is the page heading, not a bare paragraph or a second-level
    // heading buried under an import row.
    expect(screen.getByRole('heading', { level: 1, name: 'Twinkle, Twinkle, Little Star' })).toBeInTheDocument()

    // Closed by default: not reachable as an open dialog, even though its
    // label text technically still exists in the (closed) DOM node.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: 'Change piece…' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Change piece' })
    expect(within(dialog).getByLabelText(/import a score/i)).toBeInTheDocument()

    // Escape closes it and restores focus to the trigger.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  describe('analysis panel gating (roadmap 3.18, REQ-3.5.5)', () => {
    // A stub that renders AnalysisPanel unconditionally (i.e. drops the `>=`
    // check, or drops the read of the level store entirely) is killed by the
    // level-1 case below: the region would be present when it must be absent.
    it('hides the harmonic analysis at theory level 1 (the fresh-app default) — a beginner has met no roman numeral yet', async () => {
      setTheoryLevel(1)
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')
      expect(screen.queryByRole('region', { name: 'Harmonic analysis' })).not.toBeInTheDocument()
    })

    it('hides the harmonic analysis at theory level 3, the level just below the gate', async () => {
      setTheoryLevel(3)
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')
      expect(screen.queryByRole('region', { name: 'Harmonic analysis' })).not.toBeInTheDocument()
    })

    // A stub that hardcodes `=== 4` (rather than `>= 4`) is killed by this
    // case together with the level-5 case below.
    it('shows the harmonic analysis at theory level 4', async () => {
      setTheoryLevel(4)
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')
      expect(screen.getByRole('region', { name: 'Harmonic analysis' })).toBeInTheDocument()
    })

    it('still shows the harmonic analysis at theory level 5 — level 4+ never loses what it granted', async () => {
      setTheoryLevel(5)
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')
      expect(screen.getByRole('region', { name: 'Harmonic analysis' })).toBeInTheDocument()
    })
  })

  describe('numerals on the engraving (roadmap 3.18a, REQ-3.5.5)', () => {
    /** The last `measureLabels` any render handed the viewer. */
    function labelsSeenByViewer(): ReadonlyMap<number, string> | undefined {
      const calls = scoreViewerSpy.mock.calls as [
        { measureLabels?: ReadonlyMap<number, string> },
      ][]
      return calls.at(-1)?.[0].measureLabels
    }

    // 3.18a's plumbing (buildMeasureLabels, ScoreViewer's prop, the engraver's
    // setMeasureLabels) all shipped tested and CONNECTED TO NOTHING: no caller
    // ever passed the prop, so the numerals were absent from the running app
    // while every unit test stayed green. These two cases are the wiring.
    it('hands the viewer the roman numeral for each measure at theory level 4', async () => {
      setTheoryLevel(4)
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')

      await waitFor(() => expect(labelsSeenByViewer()).toBeDefined())
      const labels = labelsSeenByViewer()
      // Keyed 1-based, per the ScoreViewer contract, and carrying the sample's
      // own I-V-IV-I skeleton — the same reading the panel prints.
      expect(labels?.get(1)).toBe('I')
      expect(labels?.get(2)).toBe('V')
      expect(labels?.get(3)).toBe('IV')
      expect(labels?.size).toBe(12)
    })

    it('hands the viewer no labels below the gate, so the engraving stays clean at level 1', async () => {
      setTheoryLevel(1)
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')

      await waitFor(() => expect(scoreViewerSpy).toHaveBeenCalled())
      expect(labelsSeenByViewer()).toBeUndefined()
    })
  })

  describe('hydration gate (startup race, see levelStore.ts `hydrated`)', () => {
    // A stub that reads only `theoryLevel >= MIN_ANALYSIS_THEORY_LEVEL` (i.e.
    // drops the `hydrated &&` clause) is killed by this case: the level is
    // already 4, so only the hydration check can be keeping the panel out.
    it('renders nothing at the gate site before hydration completes, even at theory level 4 (avoids a pop-in reflow)', async () => {
      setTheoryLevel(4)
      useLevelStore.setState({ hydrated: false })
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')
      expect(screen.queryByRole('region', { name: 'Harmonic analysis' })).not.toBeInTheDocument()
    })

    it('shows the harmonic analysis once hydration completes at theory level 4', async () => {
      setTheoryLevel(4)
      useLevelStore.setState({ hydrated: true })
      render(<ScoreScreen />)
      await screen.findByText('Twinkle, Twinkle, Little Star')
      expect(screen.getByRole('region', { name: 'Harmonic analysis' })).toBeInTheDocument()
    })
  })
})
