import { describe, it, expect } from "vitest"
import { go, sleep, Err } from "ribu"
import { _Err } from "./utils.js"

describe("Job properly propagates errrors", () => {

	it("yield*, genFn returns ::Err", async () => {

		function* inner() {
			yield* sleep(1)
			return Err("SomeErrType")
		}

		function* main() {
			yield* go(inner)
			return `won't appear in settled value`
		}

		const rec = await go(main).promErr
		const exp = _Err("main", _Err("inner", Err("SomeErrType")))
		expect(rec).toStrictEqual(exp)
	})

	it("yield*, genFn throws", async () => {

		function* inner() {
			yield* sleep(1)
			throw Error("a msg")
		}

		function* main() {
			yield* go(inner)
			return `won't appear in settled value`
		}

		let rec = await go(main).promErr
		const exp = _Err("main", _Err("inner", Error("a msg")))
		expect(rec).toStrictEqual(exp)
	})

	it("yield*, genFn returns ::Error", async () => {

		function* inner() {
			yield* sleep(1)
			return Error("a msg")
		}

		function* main() {
			yield* go(inner)
			return `won't appear in settled value`
		}

		const rec = await go(main).promErr
		const exp = _Err("main", _Err("inner", Error("a msg")))
		expect(rec).toStrictEqual(exp)
	})
})
