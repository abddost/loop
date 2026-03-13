import { nanoid as _nanoid } from "nanoid"
import { ulid as _ulid } from "ulid"

/**
 * Generates a ULID string (Universally Unique Lexicographically Sortable Identifier).
 * @returns A new ULID string
 */
export function ulid(): string {
	return _ulid()
}

/**
 * Generates a time-descending ULID for reverse-chronological ordering.
 * Inverts timestamp bits so newer ULIDs sort before older ones.
 * @returns A descending ULID string
 */
export function descendingUlid(): string {
	const id = _ulid()
	const timestamp = id.slice(0, 10)
	const random = id.slice(10)
	const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	const maxIndex = crockford.length - 1
	const inverted = timestamp
		.split("")
		.map((c) => crockford[maxIndex - crockford.indexOf(c)])
		.join("")
	return inverted + random
}

/**
 * Generates a short random ID using nanoid.
 * @param size - Optional length of the ID (defaults to nanoid default of 21)
 * @returns A random ID string
 */
export function nanoid(size?: number): string {
	return _nanoid(size)
}
