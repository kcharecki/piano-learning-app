/**
 * `OnboardingGateway` (roadmap 5.40): the additive, dismissible callout
 * `Shell.tsx` renders on Today — never a hard gate. See its own module doc
 * for why. This file proves it stays inert everywhere it must (off the
 * Today route, already completed) and wires up correctly where it should
 * show, expand, and dismiss.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '@test/fakes.ts'
import { OnboardingGateway } from './OnboardingGateway.tsx'
import { ONBOARDING_COLLECTION, ONBOARDING_KEY, type OnboardingRecord } from './useOnboardingGate.ts'

afterEach(cleanup)

describe('OnboardingGateway', () => {
  it('renders nothing when show is false, even against a genuinely fresh store', async () => {
    render(<OnboardingGateway show={false} openStore={async () => new MemoryStore()} />)
    // Give the (never-consulted, since show=false short-circuits first) restore a turn.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('note', { name: /first-run setup/i })).toBeNull()
  })

  it('renders nothing once completed is already true', async () => {
    const store = new MemoryStore()
    await store.put<OnboardingRecord>(ONBOARDING_COLLECTION, ONBOARDING_KEY, { completed: true })
    render(<OnboardingGateway show={true} openStore={async () => store} />)

    await waitFor(() => {
      expect(screen.queryByRole('note', { name: /first-run setup/i })).toBeNull()
    })
  })

  it('shows the banner on a fresh store when shown on Today', async () => {
    render(<OnboardingGateway show={true} openStore={async () => new MemoryStore()} />)
    await waitFor(() => {
      expect(screen.getByRole('note', { name: /first-run setup/i })).toBeInTheDocument()
    })
  })

  it('renders nothing while a session is running, even against a genuinely fresh store (UI-08)', async () => {
    render(
      <OnboardingGateway
        show={true}
        sessionRunning={true}
        openStore={async () => new MemoryStore()}
      />,
    )
    // Give the (never-consulted, since sessionRunning=true short-circuits
    // first) restore a turn.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('note', { name: /first-run setup/i })).toBeNull()
  })

  it('the callout is never a competing primary (UI-08): "Set up my practice" is a plain secondary button', async () => {
    render(<OnboardingGateway show={true} openStore={async () => new MemoryStore()} />)
    const setup = await screen.findByRole('button', { name: 'Set up my practice' })
    expect(setup).not.toHaveClass('btn-primary')
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(0)
  })

  it('"Set up my practice" expands into the full flow', async () => {
    const user = userEvent.setup()
    render(<OnboardingGateway show={true} openStore={async () => new MemoryStore()} />)
    await waitFor(() => screen.getByRole('button', { name: 'Set up my practice' }))

    await user.click(screen.getByRole('button', { name: 'Set up my practice' }))

    expect(screen.getByRole('heading', { name: 'Set up your practice' })).toBeInTheDocument()
    expect(screen.queryByRole('note', { name: /first-run setup/i })).toBeNull()
  })

  it('"Not now" marks onboarding completed and hides the banner, without expanding', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    render(<OnboardingGateway show={true} openStore={async () => store} />)
    await waitFor(() => screen.getByRole('button', { name: 'Not now' }))

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByRole('note', { name: /first-run setup/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set up your practice' })).toBeNull()
    await waitFor(async () => {
      const raw = await store.get<OnboardingRecord>(ONBOARDING_COLLECTION, ONBOARDING_KEY)
      expect(raw).toEqual({ completed: true })
    })
  })

  it('finishing the expanded flow hides everything (the gate is satisfied)', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    render(<OnboardingGateway show={true} openStore={async () => store} />)
    await waitFor(() => screen.getByRole('button', { name: 'Set up my practice' }))
    await user.click(screen.getByRole('button', { name: 'Set up my practice' }))

    await user.click(screen.getByRole('button', { name: 'Finish setup' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Set up your practice' })).toBeNull()
    })
    expect(screen.queryByRole('note', { name: /first-run setup/i })).toBeNull()
  })
})
