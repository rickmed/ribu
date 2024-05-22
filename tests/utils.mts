import { expect } from "vitest"
import { isE, RibuE, Err, ERR_TAG } from "../source/errors.mjs"
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

export function assertRibuErr(x: unknown): asserts x is RibuE {
	expect(x).toBeInstanceOf(RibuE)
}


export function sleepProm(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

export function checkErrSpec(rec: unknown, spec: NonNullable<unknown>): void {

	if (!("message" in spec)) {
		assertHasK(rec, "message")
		expect(rec.message).toBe("")
	}
	if ("message" in spec) {
		assertHasK(rec, "message")
		expect(rec.message).toBe(spec.message)
	}

	if ("name" in spec && spec.name === "Error") {
		expect(rec).toBeInstanceOf(Error)
		assertHasK(rec, "name")
		expect(spec.name).toBe(rec.name)
		expect(rec).not.toHaveProperty("errors")
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
		if ("errors" in spec) {
			assertHasK(rec, "errors")
			assertIsArr(rec.errors)
			rec.errors.forEach((recErr, i) => {
				assertIsArr(spec.errors)
				checkErrSpec(recErr, spec.errors[i] as NonNullable<unknown>)
			})
		}

		if ("cause" in spec) {
			assertHasK(rec, "cause")
			checkErrSpec(rec.cause, spec.cause as NonNullable<unknown>)
		}
		return
	}

	// .cause is thrown value of not type Error
	expect(rec).toStrictEqual(spec)
}

function assertHasK<K extends string>(x: unknown, k: K): asserts x is { [k in K]: unknown } {
	expect(x).toHaveProperty(k)
}

function assertIsArr(x: unknown): asserts x is unknown[] {
	expect(x).instanceOf(Array)
}
