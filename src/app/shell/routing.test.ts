/**
 * The impure half of the router (see routing.ts's module comment): the
 * History-API wiring itself. `route.test.ts` covers the pure parse/serialize
 * half exhaustively (incl. property tests); this file only proves the wiring
 * — that `useRoute` reads the boot path (honouring the instrument hint on a
 * bare root), reacts to `popstate`, and drives `pushState`/`replaceState`
 * correctly — with real `happy-dom` `window`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoute } from './routing.ts'
import { INSTRUMENT_HINT_KEY } from '@app/state/instrumentStore.ts'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.removeItem(INSTRUMENT_HINT_KEY)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(INSTRUMENT_HINT_KEY)
})

describe('useRoute', () => {
  it('reads the route the app booted on', () => {
    window.history.replaceState(null, '', '/practice')
    const { result } = renderHook(() => useRoute())
    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'practice' } })
  })

  it('normalizes an unknown boot path to the piano default route without adding a history entry', () => {
    window.history.replaceState(null, '', '/nope')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHook(() => useRoute())

    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'today' } })
    expect(window.location.pathname).toBe('/today')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/today')
  })

  it('a bare root boots into piano with no stored instrument hint', () => {
    const { result } = renderHook(() => useRoute())
    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'today' } })
    expect(window.location.pathname).toBe('/today')
  })

  it('a bare root honours a stored "drums" instrument hint (DR-01 zero-flash reload)', () => {
    localStorage.setItem(INSTRUMENT_HINT_KEY, 'drums')
    const { result } = renderHook(() => useRoute())
    expect(result.current.route).toEqual({ instrument: 'drums', route: { screen: 'drums-today' } })
    expect(window.location.pathname).toBe('/drums/today')
  })

  it('an explicit /drums/... boot path wins regardless of the instrument hint', () => {
    localStorage.setItem(INSTRUMENT_HINT_KEY, 'drums')
    window.history.replaceState(null, '', '/practice')
    const { result } = renderHook(() => useRoute())
    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'practice' } })
  })

  it('navigate pushes a new history entry and updates the route', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ instrument: 'piano', route: { screen: 'lessons' } })
    })

    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'lessons' } })
    expect(window.location.pathname).toBe('/lessons')
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/lessons')
  })

  it('navigate to a drums route pushes the /drums-prefixed path', () => {
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ instrument: 'drums', route: { screen: 'drums-today' } })
    })

    expect(result.current.route).toEqual({ instrument: 'drums', route: { screen: 'drums-today' } })
    expect(window.location.pathname).toBe('/drums/today')
  })

  it('navigate carries deep-link params through to the URL', () => {
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({
        instrument: 'piano',
        route: { screen: 'technique', params: { id: 'scale-c-major', level: 2 } },
      })
    })

    expect(window.location.pathname).toBe('/technique/scale-c-major/2')
  })

  it('navigate with replace:true replaces instead of pushing', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ instrument: 'piano', route: { screen: 'practice' } }, { replace: true })
    })

    expect(pushSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/practice')
    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'practice' } })
  })

  it('a popstate event (browser Back/Forward) updates the route from the URL', () => {
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ instrument: 'piano', route: { screen: 'lessons' } })
    })
    act(() => {
      result.current.navigate({ instrument: 'piano', route: { screen: 'theory', params: { id: 'triads' } } })
    })

    // A real Back button moves `location` first, then fires `popstate` — so
    // this simulates the browser's own order rather than only the event.
    act(() => {
      window.history.replaceState(null, '', '/lessons')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.route).toEqual({ instrument: 'piano', route: { screen: 'lessons' } })
  })
})
