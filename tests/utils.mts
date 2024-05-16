import { expect } from "vitest"
import { isE, type RibuE, Err, ERR_TAG } from "../source/errors.mjs"
import { type RibuGenFn, go } from "../source/job.mjs"

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

export function assertRibuErr(x: unknown): asserts x is Err {
	expect(x).toBeInstanceOf(Err)
}


export function sleepProm(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

export function checkErrSpec(rec: unknown, spec: NonNullable<unknown>): void {

	if ("name" in spec && spec.name === "Error") {  // spec defines ::Error presence
		expect(rec).toBeInstanceOf(Error)
		assertHasK(rec, "name")
		expect(spec.name).toBe(rec.name)
		return
	}

	if ("_op" in spec) {

		assertRibuErr(rec)
		expect(rec._op).toBe(spec._op)
		expect(rec[ERR_TAG]).toBe(1)

		if (!("name" in spec)) {
			assertHasK(rec, "name")
			expect(rec.name).toBe("Err")
			expect(rec).toBeInstanceOf(Err)
		}
		if ("name" in spec) {
			assertHasK(rec, "name")
			expect(rec.name).toBe(spec.name)
		}
		if (!("message" in spec)) {
			assertHasK(rec, "message")
			expect(rec.message).toBe("")
		}
		if ("message" in spec) {
			assertHasK(rec, "message")
			expect(rec.message).toBe(spec.message)
		}
		if ("onEndErrors" in spec) {

			assertHasK(rec, "onEndErrors")
			assertIsArr(rec.onEndErrors)
			rec.onEndErrors.forEach( (recErr, i) => {
				assertIsArr(spec.onEndErrors)
				if (isE(recErr)) {
					checkErrSpec(recErr, spec.onEndErrors[i] as NonNullable<unknown>)
				}
			})
		}

		if ("cause" in spec) {
			assertHasK(rec, "cause")
			checkErrSpec(rec.cause, spec.cause as NonNullable<unknown>)
		}
		return
	}

	// cause is thrown value of not type Error
	expect(rec).toStrictEqual(spec)
}

function assertHasK<K extends string>(x: unknown, k: K): asserts x is {[k in K]: unknown} {
	expect(x).toHaveProperty(k)
}

function assertIsArr(x: unknown): asserts x is unknown[] {
	expect(x).instanceOf(Array)
}
