/**
 * `ScoreScreen` composes import + viewer and auto-loads the bundled sample
 * score (roadmap 1.17, REQ-3.2.5, REQ-5.1). `ScoreViewer` wraps OSMD, which
 * does not run in happy-dom, so it is mocked out here — this file only
 * asserts on what ScoreScreen wires into it, not on OSMD.
 */
import sampleMusicXml from '@content/scores/twinkle-twinkle-little-star.musicxml?raw'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('always renders the import panel', async () => {
    render(<ScoreScreen />)
    expect(screen.getByLabelText(/import a score/i)).toBeInTheDocument()
    await screen.findByText('Twinkle, Twinkle, Little Star')
  })
})
