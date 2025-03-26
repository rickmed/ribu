import { describe, it, expect } from "vitest"
import { Err, go, sleep } from "ribu"
import { _Err } from "../source/errors.js"

/**
 * Jobs can block and resume each other with their return values
 */


/**
 * yield* job
 * Provides automatic error propagation
 */
describe("yield* job", () => {

	it("caller job resumes if target does not fail", async () => {

		function* child() {
			yield* sleep(1)
			return "ok"
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main)
		expect(rec).toBe("ok")
	})

	it("caller job fails and propagates error via returning ::Err", async () => {

		function* child() {
			yield* sleep(1)
			return Err("SomeErrorTag")
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main).promErr
		const exp =
			_Err("main",
				_Err("child",
					Err("SomeErrorTag")
				)
			)
		expect(rec).toStrictEqual(exp)
	})


	it("caller job fails and propagates error via throwing", async () => {

		function* child() {
			yield* sleep(1)
			throw Error("SomeErrorTag")
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main).promErr
		const exp =
			_Err("main",
				_Err("child",
					Error("SomeErrorTag")
				)
			)
		expect(rec).toStrictEqual(exp)
	})
})


/**
 * yield* job.err
 * Handle errors manually.
 */
describe("yield* job.err", () => {

	it("caller job resumes if target does not fail", async () => {

		function* child() {
			yield* sleep(1)
			return "ok"
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main)
		expect(rec).toBe("ok")
	})

	it("caller job resumes if target fails via returning ::Err", async () => {

		function* child() {
			yield* sleep(1)
			return Err("SomeErrorTag")
		}

		function* main() {
			const res = yield* go(child).err
			return res
		}

		const rec = await go(main).promErr
		const exp =
			_Err("main",
				_Err("child",
					Err("SomeErrorTag")
				)
			)
		expect(rec).toStrictEqual(exp)
	})

})