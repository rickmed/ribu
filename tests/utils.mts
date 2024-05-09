import { expect } from "vitest"
import { isE, type RibuE, Err } from "../source/errors.mjs"
import { type RibuGenFn, go } from "../source/job.mjs"

export function check_Eq<T>(rec: T, exp: T): void {
	return expect(rec).toStrictEqual(exp)
}

export async function check_ThrowsAwait(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn()
		throw Error("function should have thrown")
	}
	catch (e) {
		return e
	}
}

export function goAndAwaitFn(genFn: RibuGenFn): () => Promise<unknown> {
	return async function() {
		await go(genFn)
	}
}

export function assertErr(x: unknown): asserts x is Err {
	expect(x).toBeInstanceOf(Err)
}

export function assertsRibuE(x: unknown): asserts x is RibuE {
	if (!isE(x)) {
		throw Error("value is not a Ribu Error")
	}
}

export function sleep_p(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

export function* range(start: number, end?: number) {
	if (end === undefined) {
		end = start
		for (let i = 0; i < end; i++) {
			yield i
		}
		return
	}

	for (let i = start; i < end; i++) {
		yield i
	}
}
