/**
 * Persistence port. Deliberately a dumb key/value collection API rather than a
 * query language: everything this app stores is small enough to load wholesale,
 * and REQ-4.3 wants the data trivially exportable and copyable.
 */
export interface Store {
  get<T>(collection: string, id: string): Promise<T | undefined>
  getAll<T>(collection: string): Promise<T[]>
  put<T>(collection: string, id: string, value: T): Promise<void>
  delete(collection: string, id: string): Promise<void>
  clear(collection: string): Promise<void>
  /** Every collection name that currently holds data — used by export. */
  collections(): Promise<string[]>
}

/** Collection names, centralised so a typo cannot silently create a new store. */
export const COLLECTIONS = {
  scores: 'scores',
  annotations: 'annotations',
  practiceLog: 'practiceLog',
  srsCards: 'srsCards',
  progress: 'progress',
  repertoire: 'repertoire',
  recordings: 'recordings',
  sightReadingHistory: 'sightReadingHistory',
  techniqueHistory: 'techniqueHistory',
  settings: 'settings',
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]
