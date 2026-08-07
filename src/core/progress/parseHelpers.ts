/**
 * Primitive field readers for parsing an unknown JSON record into a typed
 * value, one field at a time, each returning a `Result` that names the
 * failing field with its `path` prefix (the error text is the app's
 * import-error UX, so it is behaviour, not incidental formatting).
 *
 * Split out of `@core/progress/export.ts` purely to keep that file under the
 * project's 500-code-line limit — `export.ts` is the only consumer of this
 * module today.
 */
import { err, ok, type Result } from '@core/shared/result.ts'

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
