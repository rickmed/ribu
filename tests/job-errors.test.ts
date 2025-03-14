import { describe, it, expect } from "vitest"
import { go, sleep, Err } from "ribu"
import { checkErr } from "./utils.ts"

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
			yield* sleep(1)
			throw toThrow
		}

		function* main() {
			yield* go(inner)
			jobPropagatedErr = false
		}

		let rec = await go(main).promErr
		exp.cause.cause = toThrow
		checkErr(rec, exp)
		expect(jobPropagatedErr).toBe(true)
	})

	it("yield*, genFn returns ::Err", async () => {

		const retErr = Err("boom")
		let jobPropagatedErr = true

		function* inner() {
			yield* sleep(1)
			return retErr
		}

		function* main() {
			yield* go(inner)
			jobPropagatedErr = false
		}

		const rec = await go(main).promErr
		exp.cause.cause = retErr
		checkErr(rec, exp)
		expect(jobPropagatedErr).toBe(true)
	})

	it("yield*, genFn returns ::Error", async () => {

		const retErr = Error("boom")
		let jobPropagatedErr = true

		function* inner() {
			yield* sleep(1)
			return retErr
		}

		function* main() {
			yield* go(inner)
			jobPropagatedErr = false
		}

		const rec = await go(main).promErr
		exp.cause.cause = retErr
		checkErr(rec, exp)
		expect(jobPropagatedErr).toBe(true)
	})
})
