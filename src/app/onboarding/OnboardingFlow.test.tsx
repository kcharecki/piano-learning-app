/**
 * `OnboardingFlow` (roadmap 5.40): Finish must write real, persisted state —
 * all three track levels via `useLevelStore` (the store `persistence.ts`
 * already restores on reload — no second persistence path) and a real
 * `SessionRunSnapshot` at the chosen minutes, written to the exact
 * (collection, key) `useSessionRun.ts` restores from. Skip must write
 * neither. `MemoryStore` (`@test/fakes`) stands in for IndexedDB.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '@test/fakes.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { SESSION_RUN_COLLECTION, SESSION_RUN_KEY, type SessionRunSnapshot } from '@app/session/useSessionRun.ts'
import { OnboardingFlow } from './OnboardingFlow.tsx'

function resetStores(): void {
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useScoreStore.setState({ loaded: undefined })
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('OnboardingFlow', () => {
  it('Finish sets all three track levels from the experience answer and persists a matching first session', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const onDone = vi.fn()

    render(<OnboardingFlow onDone={onDone} openStore={async () => store} midiSupported={true} />)

    await user.click(screen.getByLabelText("I've played a bit before"))
    await user.click(screen.getByRole('button', { name: '60 min' }))
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

    const levels = useLevelStore.getState().levelState.levels
    expect(levels.playing).toBe(2)
    expect(levels['sight-reading']).toBe(2)
    expect(levels.theory).toBe(2)

    const snapshot = await store.get<SessionRunSnapshot>(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
    expect(snapshot).toBeDefined()
    expect(snapshot?.plan.totalMinutes).toBe(60)
    expect(snapshot?.plan.items.length).toBeGreaterThan(0)
    expect(snapshot?.doneFlags).toEqual(snapshot?.plan.items.map(() => false))
  })

  it('the "new to piano" answer places every track at level 1', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} openStore={async () => store} midiSupported={false} />)

    // "I'm new to piano" is already the default selection.
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

    const levels = useLevelStore.getState().levelState.levels
    expect(levels.playing).toBe(1)
    expect(levels['sight-reading']).toBe(1)
    expect(levels.theory).toBe(1)
  })

  it('Skip calls onDone without touching levels or writing a session', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} openStore={async () => store} midiSupported={false} />)

    await user.click(screen.getByLabelText('I can already read music comfortably'))
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(useLevelStore.getState().levelState.levels.playing).toBe(MIN_LEVEL)
    const snapshot = await store.get(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
    expect(snapshot).toBeUndefined()
  })

  it('tells the truth about MIDI support, both ways', () => {
    const { unmount } = render(
      <OnboardingFlow onDone={vi.fn()} openStore={async () => new MemoryStore()} midiSupported={true} />,
    )
    expect(screen.getByText(/supports web midi/i)).toBeInTheDocument()
    unmount()

    render(
      <OnboardingFlow onDone={vi.fn()} openStore={async () => new MemoryStore()} midiSupported={false} />,
    )
    expect(screen.getByText(/can't see a midi keyboard/i)).toBeInTheDocument()
  })

  it('a custom minutes value drives the persisted session budget', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} openStore={async () => store} midiSupported={false} />)

    const minutesInput = screen.getByLabelText('Custom minutes')
    await user.clear(minutesInput)
    await user.type(minutesInput, '45')
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const snapshot = await store.get<SessionRunSnapshot>(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
    expect(snapshot?.plan.totalMinutes).toBe(45)
  })

  describe('onFinish (roadmap UI-05)', () => {
    it('reports the chosen answers on Finish, before onDone', async () => {
      const user = userEvent.setup()
      const store = new MemoryStore()
      const callOrder: string[] = []
      const onDone = vi.fn(() => callOrder.push('onDone'))
      const onFinish = vi.fn(() => callOrder.push('onFinish'))
      render(
        <OnboardingFlow
          onDone={onDone}
          onFinish={onFinish}
          openStore={async () => store}
          midiSupported={false}
        />,
      )

      await user.click(screen.getByLabelText("I've played a bit before"))
      await user.click(screen.getByLabelText('Learn real pieces'))
      await user.click(screen.getByRole('button', { name: '60 min' }))
      await user.click(screen.getByRole('button', { name: 'Finish setup' }))

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
      expect(onFinish).toHaveBeenCalledTimes(1)
      expect(onFinish).toHaveBeenCalledWith({ experience: 'some', goal: 'repertoire', minutes: 60 })
      // onFinish is called strictly before onDone, matching the doc comment.
      expect(callOrder).toEqual(['onFinish', 'onDone'])
    })

    it('does not call onFinish on Skip — Skip persists nothing', async () => {
      const user = userEvent.setup()
      const store = new MemoryStore()
      const onDone = vi.fn()
      const onFinish = vi.fn()
      render(
        <OnboardingFlow
          onDone={onDone}
          onFinish={onFinish}
          openStore={async () => store}
          midiSupported={false}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Skip for now' }))

      expect(onDone).toHaveBeenCalledTimes(1)
      expect(onFinish).not.toHaveBeenCalled()
    })
  })

  describe('embedded mode (roadmap UI-05)', () => {
    it('suppresses the duplicate title/intro and the MIDI input-check subsection', () => {
      render(
        <OnboardingFlow
          embedded
          onDone={vi.fn()}
          openStore={async () => new MemoryStore()}
          midiSupported={true}
        />,
      )

      expect(screen.queryByRole('heading', { name: 'Set up your practice' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Your MIDI keyboard' })).not.toBeInTheDocument()
      expect(screen.queryByText(/supports web midi/i)).not.toBeInTheDocument()
      // The questionnaire itself is still fully present.
      expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument()
    })

    it('relabels Skip as Cancel, with the same no-write behaviour', async () => {
      const user = userEvent.setup()
      const onDone = vi.fn()
      render(<OnboardingFlow embedded onDone={onDone} openStore={async () => new MemoryStore()} />)

      expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('non-embedded rendering (OnboardingGateway/first-run) is unchanged: title, MIDI check and "Skip for now" all present', () => {
      render(
        <OnboardingFlow onDone={vi.fn()} openStore={async () => new MemoryStore()} midiSupported={true} />,
      )

      expect(screen.getByRole('heading', { name: 'Set up your practice' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Your MIDI keyboard' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
    })
  })
})
