import { describe, expect, it } from 'vitest'
import { basePrefix, toBrowserPath, toRoutePath } from './basePath.ts'

const ROOT = '/'
const PAGES = '/piano-learning-app/'

describe('basePrefix', () => {
  it('is empty at the root and drops the trailing slash otherwise', () => {
    expect(basePrefix(ROOT)).toBe('')
    expect(basePrefix(PAGES)).toBe('/piano-learning-app')
  })
})

describe('toRoutePath', () => {
  it('is the identity when the app is served from the root', () => {
    expect(toRoutePath('/', ROOT)).toBe('/')
    expect(toRoutePath('/practice', ROOT)).toBe('/practice')
    expect(toRoutePath('/drums/today', ROOT)).toBe('/drums/today')
  })

  it('strips the base so route parsing never sees the hosting prefix', () => {
    expect(toRoutePath('/piano-learning-app/practice', PAGES)).toBe('/practice')
    expect(toRoutePath('/piano-learning-app/drums/today', PAGES)).toBe('/drums/today')
    expect(toRoutePath('/piano-learning-app/theory/build-scale/1', PAGES)).toBe(
      '/theory/build-scale/1',
    )
  })

  it('reads the base itself, with or without its trailing slash, as the root route', () => {
    expect(toRoutePath('/piano-learning-app/', PAGES)).toBe('/')
    expect(toRoutePath('/piano-learning-app', PAGES)).toBe('/')
  })

  it('leaves a path outside the base alone, so the route parser still sees it', () => {
    // `parseAppRoute` owns the unknown-path fallback; pre-mangling the path
    // here would hide from it that the URL was never one of ours.
    expect(toRoutePath('/somewhere-else', PAGES)).toBe('/somewhere-else')
    // A prefix match that is not a segment boundary is NOT under the base.
    expect(toRoutePath('/piano-learning-app-2/practice', PAGES)).toBe(
      '/piano-learning-app-2/practice',
    )
  })
})

describe('toBrowserPath', () => {
  it('is the identity when the app is served from the root', () => {
    expect(toBrowserPath('/practice', ROOT)).toBe('/practice')
    expect(toBrowserPath('/', ROOT)).toBe('/')
  })

  it('prefixes the base, keeping the base URL itself slash-terminated', () => {
    expect(toBrowserPath('/practice', PAGES)).toBe('/piano-learning-app/practice')
    expect(toBrowserPath('/', PAGES)).toBe('/piano-learning-app/')
  })

  it('round-trips every route path through both bases', () => {
    for (const base of [ROOT, PAGES]) {
      for (const path of ['/', '/practice', '/drums/today', '/theory/build-scale/1']) {
        expect(toRoutePath(toBrowserPath(path, base), base)).toBe(path)
      }
    }
  })
})
