import { AppError } from "../error"

/**
 * Asserts that a condition is truthy, throwing an AppError if not.
 * @param condition - The condition to check
 * @param message - Error message if the assertion fails
 * @throws AppError if condition is falsy
 */
export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new AppError(message, { code: "ASSERTION_FAILED" })
	}
}

/**
 * Asserts that a value is defined (not undefined or null), narrowing its type.
 * @param value - The value to check
 * @param message - Error message if the value is undefined
 * @returns The value, narrowed to exclude undefined and null
 * @throws AppError if value is undefined or null
 */
export function assertDefined<T>(value: T | undefined | null, message: string): T {
	if (value === undefined || value === null) {
		throw new AppError(message, { code: "ASSERTION_FAILED" })
	}
	return value
}
