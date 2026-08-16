/**
 * `instrumentStore.ts` (DR-01): the store's own contract — `setLastInstrument`/
 * `hydrate` both update state and write-through the synchronous localStorage
 * hint `routing.ts` reads on first render. The persistence round-trip itself
 * (restore applying it, a corrupt payload degrading to the default) is
 * covered in `persistence.test.ts`, matching every sibling slice's own split
 * between "the store's own contract" and "the persistence plumbing" (see
 * e.g. `themeStore.test.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { INSTRUMENT_HINT_KEY, readInstrumentHint, useInstrumentStore } from './instrumentStore.ts'

function resetStore(): void {
  useInstrumentStore.setState({ lastInstrument: 'piano' })
  localStorage.removeItem(INSTRUMENT_HINT_KEY)
}

afterEach(resetStore)

describe('useInstrumentStore', () => {
  it('defaults to piano', () => {
    expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
  })

  it('setLastInstrument("drums") updates state and writes the hint', () => {
    useInstrumentStore.getState().setLastInstrument('drums')
    expect(useInstrumentStore.getState().lastInstrument).toBe('drums')
    expect(localStorage.getItem(INSTRUMENT_HINT_KEY)).toBe('drums')
  })

  it('setLastInstrument("piano") updates state and writes the hint', () => {
    useInstrumentStore.getState().setLastInstrument('drums')
    useInstrumentStore.getState().setLastInstrument('piano')
    expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
    expect(localStorage.getItem(INSTRUMENT_HINT_KEY)).toBe('piano')
  })

  it('hydrate applies the hint the same way setLastInstrument does', () => {
    useInstrumentStore.getState().hydrate('drums')
    expect(useInstrumentStore.getState().lastInstrument).toBe('drums')
    expect(localStorage.getItem(INSTRUMENT_HINT_KEY)).toBe('drums')
  })
})

describe('readInstrumentHint', () => {
  it('defaults to piano with no hint stored', () => {
    expect(readInstrumentHint()).toBe('piano')
  })

  it('reads back a stored "drums" hint', () => {
    localStorage.setItem(INSTRUMENT_HINT_KEY, 'drums')
    expect(readInstrumentHint()).toBe('drums')
  })

  it('treats any value other than the literal "drums" as piano — never a crash on garbage', () => {
    localStorage.setItem(INSTRUMENT_HINT_KEY, 'not-an-instrument')
    expect(readInstrumentHint()).toBe('piano')
  })
})
