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
/**
 * @public — mirrors `isOk`, which gates real parser callers (e.g.
 * `useSessionPlan.ts`). This Result type is deliberately the Rust `Result`
 * shape (`ok`/`err`, `mapResult` ~ `map`, `unwrap`/`unwrapOr`), and `isErr` is
 * the other half of that pair, not a speculative addition.
 */
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok

/** Map the success value, leaving an error untouched. */
export const mapResult = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r

/**
 * @public — Rust's `and_then`, the monadic bind that completes the same small
 * combinator set as the live `mapResult`/`unwrap`. Production already has ~60
 * hand-written `if (!r.ok) return r` short-circuits across the notation and
 * curriculum parsers (e.g. `core/notation/musicxml.ts`, `core/notation/mxl.ts`);
 * `andThen` is the named form of exactly that step.
 */
export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r)

/**
 * @public — Rust's `map_err`, the error-side dual of the live `mapResult`
 * (which maps only the success side). Same minimal Result API, the other half
 * of that pair.
 */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error))

/**
 * @public — Rust's `unwrap_or`, the non-throwing sibling of the live `unwrap`
 * (`core/theory/intervals.ts`) for call sites that want a default instead of
 * an exception on `Err`.
 */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T => (r.ok ? r.value : fallback)

/**
 * Extract the value or throw. Only for tests and for places where the value has
 * already been validated — never as a way to skip error handling.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value
  throw new Error(`unwrap() on Err: ${JSON.stringify(r.error)}`)
}

/**
 * Collect an array of Results into a Result of an array, failing on the first error.
 *
 * @public — Rust's `Iterator<Result<T, E>>::collect::<Result<Vec<T>, E>>()`, the
 * standard batch-validation shape for this same Result API; the parsers here
 * (`core/notation/*`, `core/curriculum/*`) all build lists of fallibly-parsed
 * items and are the natural caller once one validates a whole list at once
 * instead of the first item that fails.
 */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return ok(values)
}
