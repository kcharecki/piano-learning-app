/**
 * Primitive field readers for parsing an unknown JSON record into a typed
 * value, one field at a time, each returning a `Result` that names the
 * failing field with its `path` prefix (the error text is the app's
 * import-error UX, so it is behaviour, not incidental formatting).
 *
 * Split out of `@core/progress/export.ts` purely to keep that file under the
 * project's 500-code-line limit — `export.ts` is the only consumer of this
 * module today. `parsePracticeEntry`/`parseCard`/`parseSightReadingRecord`
 * below are full item parsers, not primitives, moved here for the same
 * line-budget reason (roadmap 4.10): each is self-contained (its result type
 * comes from a leaf module, not from `export.ts`), so relocating them creates
 * no import cycle.
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { ACTIVITY_KINDS, type ActivityKind, type PracticeEntry } from '@core/progress/log.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Result<string, string> {
  const value = obj[key]
  if (typeof value !== 'string') return err(`${path}.${key}: expected string, got ${typeOf(value)}`)
  return ok(value)
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Result<string | undefined, string> {
  const value = obj[key]
  if (value === undefined) return ok(undefined)
  if (typeof value !== 'string') return err(`${path}.${key}: expected string, got ${typeOf(value)}`)
  return ok(value)
}

export function requireFiniteNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Result<number, string> {
  const value = obj[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return err(`${path}.${key}: expected finite number, got ${typeOf(value)}`)
  }
  return ok(value)
}

export function optionalFiniteNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Result<number | undefined, string> {
  const value = obj[key]
  if (value === undefined) return ok(undefined)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return err(`${path}.${key}: expected finite number, got ${typeOf(value)}`)
  }
  return ok(value)
}

export function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): Result<boolean, string> {
  const value = obj[key]
  if (typeof value !== 'boolean') return err(`${path}.${key}: expected boolean, got ${typeOf(value)}`)
  return ok(value)
}

export function parseArray<T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => Result<T, string>,
): Result<readonly T[], string> {
  if (!Array.isArray(value)) return err(`${path}: expected array, got ${typeOf(value)}`)
  const out: T[] = []
  for (let i = 0; i < value.length; i++) {
    const result = parseItem(value[i], `${path}[${i}]`)
    if (!result.ok) return result
    out.push(result.value)
  }
  return ok(out)
}

/**
 * Like `parseArray`, but a genuinely MISSING field (`value === undefined`)
 * returns `ok(undefined)` rather than an error — for a field that did not
 * exist on an older exported file (e.g. a repertoire piece's `sessions`
 * before roadmap 4.10's export widening). A *present but malformed* value
 * (wrong type, or an item that fails `parseItem`) is still reported exactly
 * like `parseArray` would. Whether the caller then defaults the `undefined`
 * to `[]` or leaves it absent is a domain decision this helper does not make.
 */
export function optionalArray<T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => Result<T, string>,
): Result<readonly T[] | undefined, string> {
  if (value === undefined) return ok(undefined)
  return parseArray(value, path, parseItem)
}

export function parsePracticeEntry(item: unknown, path: string): Result<PracticeEntry, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const startedAt = requireFiniteNumber(item, 'startedAt', path)
  if (!startedAt.ok) return startedAt
  const endedAt = requireFiniteNumber(item, 'endedAt', path)
  if (!endedAt.ok) return endedAt
  if (endedAt.value < startedAt.value) {
    return err(
      `${path}.endedAt: ${endedAt.value} is before startedAt (${startedAt.value})`,
    )
  }
  const kindStr = requireString(item, 'kind', path)
  if (!kindStr.ok) return kindStr
  if (!ACTIVITY_KINDS.includes(kindStr.value as ActivityKind)) {
    return err(`${path}.kind: '${kindStr.value}' is not a valid ActivityKind`)
  }
  const kind = kindStr.value as ActivityKind
  const itemName = requireString(item, 'itemName', path)
  if (!itemName.ok) return itemName
  const itemId = optionalString(item, 'itemId', path)
  if (!itemId.ok) return itemId
  const tempoBpm = optionalFiniteNumber(item, 'tempoBpm', path)
  if (!tempoBpm.ok) return tempoBpm
  const accuracy = optionalFiniteNumber(item, 'accuracy', path)
  if (!accuracy.ok) return accuracy
  const note = optionalString(item, 'note', path)
  if (!note.ok) return note
  return ok({
    id: id.value,
    startedAt: startedAt.value,
    endedAt: endedAt.value,
    kind,
    ...(itemId.value === undefined ? {} : { itemId: itemId.value }),
    itemName: itemName.value,
    ...(tempoBpm.value === undefined ? {} : { tempoBpm: tempoBpm.value }),
    ...(accuracy.value === undefined ? {} : { accuracy: accuracy.value }),
    ...(note.value === undefined ? {} : { note: note.value }),
  })
}

export function parseCard(item: unknown, path: string): Result<Card, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const due = requireFiniteNumber(item, 'due', path)
  if (!due.ok) return due
  const intervalDays = requireFiniteNumber(item, 'intervalDays', path)
  if (!intervalDays.ok) return intervalDays
  const ease = requireFiniteNumber(item, 'ease', path)
  if (!ease.ok) return ease
  const reps = requireFiniteNumber(item, 'reps', path)
  if (!reps.ok) return reps
  const lapses = requireFiniteNumber(item, 'lapses', path)
  if (!lapses.ok) return lapses
  const introducedAt = requireFiniteNumber(item, 'introducedAt', path)
  if (!introducedAt.ok) return introducedAt
  return ok({
    id: id.value,
    due: due.value,
    intervalDays: intervalDays.value,
    ease: ease.value,
    reps: reps.value,
    lapses: lapses.value,
    introducedAt: introducedAt.value,
  })
}

export function parseSightReadingRecord(item: unknown, path: string): Result<SightReadingRecord, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const pieceId = requireString(item, 'pieceId', path)
  if (!pieceId.ok) return pieceId
  const readAt = requireFiniteNumber(item, 'readAt', path)
  if (!readAt.ok) return readAt
  const accuracy = requireFiniteNumber(item, 'accuracy', path)
  if (!accuracy.ok) return accuracy
  const level = requireFiniteNumber(item, 'level', path)
  if (!level.ok) return level
  return ok({
    pieceId: pieceId.value,
    readAt: readAt.value,
    accuracy: accuracy.value,
    level: level.value,
  })
}
