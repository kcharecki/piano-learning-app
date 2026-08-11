/**
 * `ReferencePanel` wiring tests (roadmap 3.17): render, mount-on-first-open,
 * hide-not-unmount, aria contract, focus and Escape. The music content itself
 * (scale/chord data, playback) is `ChordScaleReference.test.tsx`'s job — this
 * file only proves the panel's own chrome behaves per `docs/parallel-round-10.md`
 * Q2's resolved mechanism.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReferencePanel } from './ReferencePanel.tsx'

// OSMD cannot run in this test environment — same mock ChordScaleReference's
// own test file and Shell.test.tsx use for the ScaleStaff -> ExerciseScore ->
// ScoreViewer chain this panel reaches through ChordScaleReference.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-title={score.meta.title} />
  ),
}))

afterEach(cleanup)

describe('ReferencePanel', () => {
  it('mounts nothing while closed and never opened', () => {
    render(<ReferencePanel open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('complementary', { name: /chord and scale reference/i })).toBeNull()
  })

  it('mounts its content on first open, with the correct aria contract', () => {
    render(<ReferencePanel open={true} onClose={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: /chord and scale reference/i })
    expect(panel).toHaveAttribute('id', 'reference-panel')
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(panel).not.toBeNull()
  })

  it('hides via the `hidden` attribute on close rather than unmounting', () => {
    const { rerender } = render(<ReferencePanel open={true} onClose={vi.fn()} />)
    screen.getByTestId('reference-scale-name')

    rerender(<ReferencePanel open={false} onClose={vi.fn()} />)
    // Still in the DOM (queryByRole with `hidden: false` default excludes
    // hidden elements from the accessibility tree, matching real AT
    // behaviour) — assert via the raw id lookup that it was not unmounted.
    const panel = document.getElementById('reference-panel')
    expect(panel).not.toBeNull()
    expect(panel).toHaveAttribute('hidden')
    // The heading text is still present in markup (hidden, not removed) —
    // proof the OSMD/ChordScaleReference subtree was never torn down.
    expect(panel?.querySelector('h3')).not.toBeNull()

    rerender(<ReferencePanel open={true} onClose={vi.fn()} />)
    expect(document.getElementById('reference-panel')).not.toHaveAttribute('hidden')
  })

  it('moves focus to the close button on open', () => {
    render(<ReferencePanel open={true} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /close reference/i })).toHaveFocus()
  })

  it('calls onClose when Escape is pressed while open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReferencePanel open={true} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on Escape while closed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    // Open once so content mounts, then close, then press Escape.
    const { rerender } = render(<ReferencePanel open={true} onClose={onClose} />)
    rerender(<ReferencePanel open={false} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReferencePanel open={true} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /close reference/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the scrim is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReferencePanel open={true} onClose={onClose} />)

    await user.click(screen.getByTestId('reference-panel-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('preserves the selected root/scale across a close and reopen (state survives the hide)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ReferencePanel open={true} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Scale'), 'naturalMinor')
    expect(screen.getByRole('heading', { name: /natural minor/i })).toBeInTheDocument()

    rerender(<ReferencePanel open={false} onClose={vi.fn()} />)
    rerender(<ReferencePanel open={true} onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /natural minor/i })).toBeInTheDocument()
  })
})
