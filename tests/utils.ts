import { Err } from "ribu"

export function _Err(fnName: string, cause?: unknown) {
	return Err("GenFnErr", fnName, "", cause)
}

export async function checkAsyncFnThrows(fn: () => Promise<unknown>) {
	try {
		await fn()
		throw Error("function should have thrown")
	}
	catch (e) {
		return e
	}
}

export function sleepProm(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

/**
 * Creates a clone of an Err object, preserving its prototype chain and properties.
 * Specifically designed for use in tests to create independent copies of error objects.
 * @param err The error object to clone
 * @returns A clone of the error with the same properties and prototype
 */
export function clone<T>(err: T): T {
	// Create a new instance of the same error type
	const proto = Object.getPrototypeOf(err) as object
	const clone = Object.create(proto) as T

	// Copy all properties
	for (const key of Object.getOwnPropertyNames(err)) {
		const descriptor = Object.getOwnPropertyDescriptor(err, key)
		if (descriptor) {
			Object.defineProperty(clone, key, descriptor)
		}
	}

	return clone
}
