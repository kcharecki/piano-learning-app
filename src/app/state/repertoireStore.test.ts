/**
 * repertoireStore (roadmap 4.5, REQ-3.8.2/3.8.3/3.8.4) — tested the same way
 * `techniqueStore.test.ts` tests its own collection: the store is a thin
 * pass-through, so these tests prove the delegation reaches core (defaults,
 * non-mutation of siblings, the throw-on-unknown-id convention) and the cap.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { NewPieceInput, RepertoireSession } from '@core/repertoire/repertoire.ts'
import { MAX_STORED_REPERTOIRE_PIECES, useRepertoireStore } from './repertoireStore.ts'

function resetStore(): void {
  useRepertoireStore.setState({ pieces: [] })
}

afterEach(resetStore)

function pieceInput(id: string, overrides: Partial<NewPieceInput> = {}): NewPieceInput {
  return {
    id,
    title: `Title ${id}`,
    composer: 'Composer',
    level: 3,
    ...overrides,
  }
}

describe('repertoireStore', () => {
  it('addPiece on ok puts a fresh piece into pieces', () => {
    const result = useRepertoireStore.getState().addPiece(pieceInput('p1'))

    expect(result.ok).toBe(true)
    const pieces = useRepertoireStore.getState().pieces
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({
      id: 'p1',
      status: 'learning',
      sessions: [],
      bestAccuracy: 0,
      notes: '',
    })
  })

  it('addPiece on a duplicate id errs naming the id, and leaves pieces untouched', () => {
    useRepertoireStore.getState().addPiece(pieceInput('dup'))
    const before = useRepertoireStore.getState().pieces

    const result = useRepertoireStore.getState().addPiece(pieceInput('dup'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('dup')
    }
    // Not just equal — the exact same array reference, proving no half-apply.
    expect(useRepertoireStore.getState().pieces).toBe(before)
  })

  it('addPiece with a blank title errs and leaves pieces empty', () => {
    const result = useRepertoireStore.getState().addPiece(pieceInput('p1', { title: '   ' }))

    expect(result.ok).toBe(false)
    expect(useRepertoireStore.getState().pieces).toEqual([])
  })

  it('addPiece with level 0 errs and leaves pieces empty', () => {
    const result = useRepertoireStore.getState().addPiece(pieceInput('p1', { level: 0 }))

    expect(result.ok).toBe(false)
    expect(useRepertoireStore.getState().pieces).toEqual([])
  })

  it('addPiece with level 6 errs and leaves pieces empty', () => {
    const result = useRepertoireStore.getState().addPiece(pieceInput('p1', { level: 6 }))

    expect(result.ok).toBe(false)
    expect(useRepertoireStore.getState().pieces).toEqual([])
  })

  it('setStatus moves exactly the named piece and leaves siblings by reference', () => {
    useRepertoireStore.getState().addPiece(pieceInput('a'))
    useRepertoireStore.getState().addPiece(pieceInput('b'))
    const siblingBefore = useRepertoireStore.getState().pieces.find((p) => p.id === 'b')

    useRepertoireStore.getState().setStatus('a', 'polishing')

    const pieces = useRepertoireStore.getState().pieces
    expect(pieces.find((p) => p.id === 'a')?.status).toBe('polishing')
    // Same object reference, proving core's non-mutation reaches the store.
    expect(pieces.find((p) => p.id === 'b')).toBe(siblingBefore)
  })

  it('setNotes moves exactly the named piece and leaves siblings by reference', () => {
    useRepertoireStore.getState().addPiece(pieceInput('a'))
    useRepertoireStore.getState().addPiece(pieceInput('b'))
    const siblingBefore = useRepertoireStore.getState().pieces.find((p) => p.id === 'b')

    useRepertoireStore.getState().setNotes('a', 'practice slowly')

    const pieces = useRepertoireStore.getState().pieces
    expect(pieces.find((p) => p.id === 'a')?.notes).toBe('practice slowly')
    expect(pieces.find((p) => p.id === 'b')).toBe(siblingBefore)
  })

  it('recordSession appends the session and raises bestAccuracy when it improves', () => {
    useRepertoireStore.getState().addPiece(pieceInput('a'))

    const session: RepertoireSession = { at: 1_000, minutes: 10, accuracy: 0.7 }
    useRepertoireStore.getState().recordSession('a', session)

    const piece = useRepertoireStore.getState().pieces.find((p) => p.id === 'a')
    expect(piece?.sessions).toEqual([session])
    expect(piece?.bestAccuracy).toBe(0.7)
  })

  it('recordSession leaves bestAccuracy alone when the session does not beat it', () => {
    useRepertoireStore.getState().addPiece(pieceInput('a'))
    useRepertoireStore.getState().recordSession('a', { at: 1_000, minutes: 10, accuracy: 0.7 })

    useRepertoireStore.getState().recordSession('a', { at: 2_000, minutes: 5, accuracy: 0.4 })

    const piece = useRepertoireStore.getState().pieces.find((p) => p.id === 'a')
    expect(piece?.sessions).toHaveLength(2)
    expect(piece?.bestAccuracy).toBe(0.7)
  })

  it('recordSession with an unknown id throws and leaves pieces unchanged', () => {
    useRepertoireStore.getState().addPiece(pieceInput('a'))
    const before = useRepertoireStore.getState().pieces

    expect(() =>
      useRepertoireStore.getState().recordSession('nope', { at: 1_000, minutes: 1 }),
    ).toThrow()
    expect(useRepertoireStore.getState().pieces).toBe(before)
  })

  it('hydrate replaces the collection wholesale', () => {
    useRepertoireStore.getState().addPiece(pieceInput('a'))

    useRepertoireStore.getState().hydrate({
      pieces: [
        {
          id: 'z',
          title: 'Hydrated',
          composer: 'Someone',
          level: 2,
          status: 'maintained',
          sessions: [],
          bestAccuracy: 0.9,
          notes: '',
        },
      ],
    })

    const pieces = useRepertoireStore.getState().pieces
    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.id).toBe('z')
  })

  it('caps at MAX_STORED_REPERTOIRE_PIECES, keeping the first that many and dropping the newest', () => {
    for (let i = 0; i < MAX_STORED_REPERTOIRE_PIECES + 5; i++) {
      useRepertoireStore.getState().addPiece(pieceInput(`p${i}`))
    }

    const pieces = useRepertoireStore.getState().pieces
    expect(pieces).toHaveLength(MAX_STORED_REPERTOIRE_PIECES)
    // Oldest kept: the very first piece added is still there...
    expect(pieces[0]?.id).toBe('p0')
    expect(pieces[pieces.length - 1]?.id).toBe(`p${MAX_STORED_REPERTOIRE_PIECES - 1}`)
    // ...and the specific pieces added past the cap were dropped, not just
    // "some piece" — the newest ones, not an existing one evicted for them.
    expect(pieces.some((p) => p.id === `p${MAX_STORED_REPERTOIRE_PIECES}`)).toBe(false)
    expect(pieces.some((p) => p.id === `p${MAX_STORED_REPERTOIRE_PIECES + 4}`)).toBe(false)
  })
})
