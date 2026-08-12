import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '@core/ports/store.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { MemoryStore } from '@test/fakes.ts'
import {
  createIdbStore,
  createMissingStores,
  deleteRecordingAudio,
  getRecordingAudio,
  putRecordingAudio,
  type StoredRecordingAudio,
} from './idb.ts'

let dbCounter = 0
/** A fresh, never-before-used IndexedDB database name for the test that asks for it. */
function freshDbName(): string {
  dbCounter += 1
  return `contract-test-${dbCounter}`
}

/**
 * Shared assertions run against every `Store` implementation. This is what
 * makes the port swap between `MemoryStore` and `createIdbStore` safe: if a
 * behaviour only one of them has, it belongs here, not in an
 * implementation-specific test.
 */
export function defineStoreContract(label: string, createStore: () => Promise<Store>): void {
  describe(`Store contract: ${label}`, () => {
    let store: Store

    beforeEach(async () => {
      store = await createStore()
    })

    it('returns undefined for an absent key', async () => {
      expect(await store.get(COLLECTIONS.scores, 'missing')).toBeUndefined()
    })

    it('put then get round-trips the value', async () => {
      const value = { title: 'Für Elise', measures: 3 }
      await store.put(COLLECTIONS.scores, 'piece-1', value)
      expect(await store.get(COLLECTIONS.scores, 'piece-1')).toEqual(value)
    })

    it('overwrite replaces the value at the same id', async () => {
      await store.put(COLLECTIONS.scores, 'piece-1', { title: 'first' })
      await store.put(COLLECTIONS.scores, 'piece-1', { title: 'second' })
      expect(await store.get(COLLECTIONS.scores, 'piece-1')).toEqual({ title: 'second' })
    })

    it('getAll returns every value in a collection', async () => {
      await store.put(COLLECTIONS.scores, 'a', { title: 'A' })
      await store.put(COLLECTIONS.scores, 'b', { title: 'B' })
      const all = await store.getAll<{ title: string }>(COLLECTIONS.scores)
      expect(all.map((v) => v.title).sort()).toEqual(['A', 'B'])
    })

    it('getAll on a collection with no data returns an empty array', async () => {
      expect(await store.getAll(COLLECTIONS.scores)).toEqual([])
    })

    it('delete removes the value', async () => {
      await store.put(COLLECTIONS.scores, 'piece-1', { title: 'gone soon' })
      await store.delete(COLLECTIONS.scores, 'piece-1')
      expect(await store.get(COLLECTIONS.scores, 'piece-1')).toBeUndefined()
    })

    it('delete of an absent key is a no-op', async () => {
      await expect(store.delete(COLLECTIONS.scores, 'never-existed')).resolves.toBeUndefined()
    })

    it('clear empties a collection', async () => {
      await store.put(COLLECTIONS.scores, 'a', { title: 'A' })
      await store.put(COLLECTIONS.scores, 'b', { title: 'B' })
      await store.clear(COLLECTIONS.scores)
      expect(await store.getAll(COLLECTIONS.scores)).toEqual([])
    })

    it('isolates values with the same id across different collections', async () => {
      await store.put(COLLECTIONS.scores, 'shared-id', { kind: 'score' })
      await store.put(COLLECTIONS.annotations, 'shared-id', { kind: 'annotation' })
      expect(await store.get(COLLECTIONS.scores, 'shared-id')).toEqual({ kind: 'score' })
      expect(await store.get(COLLECTIONS.annotations, 'shared-id')).toEqual({
        kind: 'annotation',
      })
    })

    it('clearing one collection leaves another untouched', async () => {
      await store.put(COLLECTIONS.scores, 'a', { title: 'A' })
      await store.put(COLLECTIONS.annotations, 'x', { note: 'X' })
      await store.clear(COLLECTIONS.scores)
      expect(await store.getAll(COLLECTIONS.annotations)).toEqual([{ note: 'X' }])
    })

    it('collections lists only collections that currently hold data', async () => {
      expect(await store.collections()).toEqual([])
      await store.put(COLLECTIONS.scores, 'a', { title: 'A' })
      expect(await store.collections()).toEqual([COLLECTIONS.scores])
      await store.put(COLLECTIONS.annotations, 'x', { note: 'X' })
      expect(new Set(await store.collections())).toEqual(
        new Set([COLLECTIONS.scores, COLLECTIONS.annotations]),
      )
    })

    it('collections omits a collection cleared back to empty', async () => {
      await store.put(COLLECTIONS.scores, 'a', { title: 'A' })
      await store.clear(COLLECTIONS.scores)
      expect(await store.collections()).toEqual([])
    })

    it('mutating the value after put does not change what was stored', async () => {
      const value = { title: 'original', tags: ['x'] }
      await store.put(COLLECTIONS.scores, 'piece-1', value)
      value.title = 'mutated'
      value.tags.push('y')
      expect(await store.get(COLLECTIONS.scores, 'piece-1')).toEqual({
        title: 'original',
        tags: ['x'],
      })
    })

    it('mutating a get() result does not change what is stored', async () => {
      await store.put(COLLECTIONS.scores, 'piece-1', { title: 'original', tags: ['x'] })
      const first = await store.get<{ title: string; tags: string[] }>(
        COLLECTIONS.scores,
        'piece-1',
      )
      first?.tags.push('y')
      expect(await store.get(COLLECTIONS.scores, 'piece-1')).toEqual({
        title: 'original',
        tags: ['x'],
      })
    })

    it('rejects a value that cannot be structured-cloned', async () => {
      const unclonable = { fn: () => 'nope' }
      await expect(store.put(COLLECTIONS.scores, 'x', unclonable)).rejects.toThrow()
    })
  })
}

defineStoreContract('MemoryStore', () => Promise.resolve(new MemoryStore()))
defineStoreContract('createIdbStore', () => createIdbStore(freshDbName()))

describe('createIdbStore', () => {
  it('creates one object store per collection', async () => {
    const store = await createIdbStore(freshDbName())
    await store.put(COLLECTIONS.repertoire, 'r1', { status: 'active' })
    expect(await store.get(COLLECTIONS.repertoire, 'r1')).toEqual({ status: 'active' })
  })

  it('defaults to a stable database name so repeat opens see prior data', async () => {
    const name = freshDbName()
    const first = await createIdbStore(name)
    await first.put(COLLECTIONS.settings, 'theme', { value: 'dark' })

    const second = await createIdbStore(name)
    expect(await second.get(COLLECTIONS.settings, 'theme')).toEqual({ value: 'dark' })
  })

  it('an unclonable value fails with a clear, specific error rather than an opaque one', async () => {
    const store = await createIdbStore(freshDbName())
    const unclonable = { handler: () => undefined }
    await expect(store.put(COLLECTIONS.scores, 'piece-1', unclonable)).rejects.toThrow(
      /Store\.put\(scores\/piece-1\).*cannot be structured-cloned/,
    )
  })

  it('adding a collection at a later database version does not lose existing data', async () => {
    const name = freshDbName()

    const v1 = await openDB(name, 1, {
      upgrade(database) {
        createMissingStores(database, ['scores'])
      },
    })
    await v1.put('scores', { title: 'Für Elise' }, 'piece-1')
    v1.close()

    const v2 = await openDB(name, 2, {
      upgrade(database) {
        createMissingStores(database, ['scores', 'annotations'])
      },
    })
    expect(await v2.get('scores', 'piece-1')).toEqual({ title: 'Für Elise' })
    expect(v2.objectStoreNames.contains('annotations')).toBe(true)
    expect(await v2.getAll('annotations')).toEqual([])
    v2.close()
  })
})

/**
 * roadmap B.5 (REQ-3.9.2): the recording-audio side-store. Run against both
 * `Store` implementations, same reasoning as `defineStoreContract` above —
 * behaviour that differs between `MemoryStore` and the real IndexedDB store
 * (a real `Blob` round-tripping through IndexedDB's structured-clone
 * algorithm, in particular) has to be caught here, not assumed.
 */
function defineRecordingAudioContract(label: string, createStore: () => Promise<Store>): void {
  describe(`recording audio (${label})`, () => {
    it('put then get round-trips the blob, mime type, and offset', async () => {
      const store = await createStore()
      const blob = new Blob(['fake webm bytes'], { type: 'audio/webm' })
      const audio: StoredRecordingAudio = {
        recordingId: 'rec-1',
        blob,
        mimeType: 'audio/webm',
        offsetMs: -12,
      }

      await putRecordingAudio(store, audio)
      const found = await getRecordingAudio(store, 'rec-1')

      expect(found).toBeDefined()
      expect(found?.recordingId).toBe('rec-1')
      expect(found?.mimeType).toBe('audio/webm')
      expect(found?.offsetMs).toBe(-12)
      expect(found?.blob).toBeInstanceOf(Blob);
      expect(await found?.blob.text()).toBe('fake webm bytes')
    })

    it('an old recording that never had audio stored returns undefined — the migration path', async () => {
      const store = await createStore()
      // No `putRecordingAudio` call at all for this id, exactly as every
      // `Recording` made before roadmap B.5 shipped.
      expect(await getRecordingAudio(store, 'pre-existing-recording')).toBeUndefined()
    })

    it('deleteRecordingAudio removes just the audio, not the MIDI recording under the shared collection', async () => {
      const store = await createStore()
      await store.put(COLLECTIONS.recordings, 'recordings', {
        recordings: [{ id: 'rec-1', recordedAt: 0, durationMs: 100, events: [] }],
      })
      await putRecordingAudio(store, {
        recordingId: 'rec-1',
        blob: new Blob(['x']),
        mimeType: 'audio/webm',
        offsetMs: 0,
      })

      await deleteRecordingAudio(store, 'rec-1')

      expect(await getRecordingAudio(store, 'rec-1')).toBeUndefined()
      expect(await store.get(COLLECTIONS.recordings, 'recordings')).toEqual({
        recordings: [{ id: 'rec-1', recordedAt: 0, durationMs: 100, events: [] }],
      })
    })

    it('deleting audio for an id that never had any is a no-op', async () => {
      const store = await createStore()
      await expect(deleteRecordingAudio(store, 'never-had-audio')).resolves.toBeUndefined()
    })

    it('a second put for the same recordingId replaces the first', async () => {
      const store = await createStore()
      await putRecordingAudio(store, {
        recordingId: 'rec-1',
        blob: new Blob(['first']),
        mimeType: 'audio/webm',
        offsetMs: 0,
      })
      await putRecordingAudio(store, {
        recordingId: 'rec-1',
        blob: new Blob(['second']),
        mimeType: 'audio/ogg',
        offsetMs: 5,
      })

      const found = await getRecordingAudio(store, 'rec-1')
      expect(found?.mimeType).toBe('audio/ogg')
      expect(await found?.blob.text()).toBe('second')
    })
  })
}

defineRecordingAudioContract('MemoryStore', () => Promise.resolve(new MemoryStore()))
defineRecordingAudioContract('createIdbStore', () => createIdbStore(freshDbName()))
