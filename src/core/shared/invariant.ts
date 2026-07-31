/**
 * Invariants guard programmer error — states that should be impossible if the
 * code is correct. User input never reaches these; it goes through Result.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant violated: ${message}`)
    this.name = 'InvariantError'
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message)
}

/**
 * Exhaustiveness check for discriminated unions. Calling this in a `default:`
 * branch turns a forgotten case into a compile error.
 */
export function assertNever(value: never, message = 'unexpected value'): never {
  throw new InvariantError(`${message}: ${JSON.stringify(value)}`)
}

/** Array access that fails loudly instead of returning undefined. */
export function at<T>(array: readonly T[], index: number): T {
  const value = array[index]
  if (value === undefined) {
    throw new InvariantError(`index ${index} out of bounds (length ${array.length})`)
  }
  return value
}
