/**
 * Minimal Result type. Parsers and validators in the core return this instead of
 * throwing, so that callers are forced by the type system to handle bad input —
 * which is the normal case when the user imports an arbitrary MusicXML file.
 *
 * `throw` is reserved for programmer error (broken invariants).
 */
export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E = string> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok

/** Map the success value, leaving an error untouched. */
export const mapResult = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r

/** Chain a fallible step. */
export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r)

/** Map the error value, leaving a success untouched. */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error))

/** Extract the value or fall back. */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T => (r.ok ? r.value : fallback)

/**
 * Extract the value or throw. Only for tests and for places where the value has
 * already been validated — never as a way to skip error handling.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value
  throw new Error(`unwrap() on Err: ${JSON.stringify(r.error)}`)
}

/** Collect an array of Results into a Result of an array, failing on the first error. */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return ok(values)
}
