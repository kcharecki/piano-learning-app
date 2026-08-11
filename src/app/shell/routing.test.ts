/**
 * The impure half of the router (see routing.ts's module comment): the
 * History-API wiring itself. `route.test.ts` covers the pure parse/serialize
 * half exhaustively (incl. property tests); this file only proves the wiring
 * — that `useRoute` reads the boot path, reacts to `popstate`, and drives
 * `pushState`/`replaceState` correctly — with real `happy-dom` `window`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoute } from './routing.ts'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRoute', () => {
  it('reads the route the app booted on', () => {
    window.history.replaceState(null, '', '/practice')
    const { result } = renderHook(() => useRoute())
    expect(result.current.route).toEqual({ screen: 'practice' })
  })

  it('normalizes an unknown boot path to the default route without adding a history entry', () => {
    window.history.replaceState(null, '', '/nope')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHook(() => useRoute())

    expect(result.current.route).toEqual({ screen: 'today' })
    expect(window.location.pathname).toBe('/today')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/today')
  })

  it('navigate pushes a new history entry and updates the route', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ screen: 'lessons' })
    })

    expect(result.current.route).toEqual({ screen: 'lessons' })
    expect(window.location.pathname).toBe('/lessons')
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/lessons')
  })

  it('navigate carries deep-link params through to the URL', () => {
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ screen: 'technique', params: { id: 'scale-c-major', level: 2 } })
    })

    expect(window.location.pathname).toBe('/technique/scale-c-major/2')
  })

  it('navigate with replace:true replaces instead of pushing', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ screen: 'practice' }, { replace: true })
    })

    expect(pushSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/practice')
    expect(result.current.route).toEqual({ screen: 'practice' })
  })

  it('a popstate event (browser Back/Forward) updates the route from the URL', () => {
    const { result } = renderHook(() => useRoute())

    act(() => {
      result.current.navigate({ screen: 'lessons' })
    })
    act(() => {
      result.current.navigate({ screen: 'theory', params: { id: 'triads' } })
    })

    // A real Back button moves `location` first, then fires `popstate` — so
    // this simulates the browser's own order rather than only the event.
    act(() => {
      window.history.replaceState(null, '', '/lessons')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.route).toEqual({ screen: 'lessons' })
  })
})
