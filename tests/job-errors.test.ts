import { describe, it, expect } from "vitest"
import { go, sleep, Err as newErr } from "../source/index.ts"
import { Err } from "../source/errors.ts"


describe("Job properly propagates errrors", () => {

	let exp = {
		name: "Err",
		fn: "main",
		message: "",
		cause: {
			name: "Err",
			fn: "inner",
			message: "",
			cause: undefined as unknown as Error,
		},
	}

	it("yield*, genFn throws", async () => {

		const toThrow = Error("boom")
		let jobPropagatedErr = true

		function* inner() {
			yield sleep(1)
			throw toThrow
		}

		function* main() {
			yield* go(inner)
			jobPropagatedErr = false
		}

		let rec = await go(main).pErr
		exp.cause.cause = toThrow
		checkErr(rec, exp)
		expect(jobPropagatedErr).toBe(true)
	})

	it("yield*, genFn returns Err", async () => {

		const retErr = newErr("boom")
		let jobPropagatedErr = true

		function* inner() {
			yield sleep(1)
			return retErr
		}

		function* main() {
			yield* go(inner)
			jobPropagatedErr = false
		}

		const rec = await go(main).pErr
		exp.cause.cause = retErr
		checkErr(rec, exp)
		expect(jobPropagatedErr).toBe(true)
	})

})

// todo: if genFn returne Err, it signals failure (doesn't work with ::Error)

function checkErr(rec: unknown, exp: unknown) {
	assertRibuErr(rec)
	expect(rec).toEqual(exp)
	expect(rec).toBeInstanceOf(Err)
}

function assertRibuErr(x: unknown): asserts x is Err {
	expect(x).toBeInstanceOf(Err)
}