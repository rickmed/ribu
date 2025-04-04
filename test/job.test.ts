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
 * yield* job.handle
 * Handle errors manually.
 */
describe("yield* job.handle", () => {

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
			const res = yield* go(child).handle
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

describe("Access job states", () => {

	it("successful job", async () => {

		function* okJob () {
			yield* sleep(1)
			return "allOk"
		}

		const job = go(okJob)
		expect(job.isDone()).toBe(false)
		expect(job.isOk()).toBe(false)
		expect(job.isErr()).toBe(false)
		await job
		expect(job.isDone() && job.val).toBe("allOk")
		expect(job.st).toBe("done")
	})

	// it("failed job", async () => {

	// 	function* badJob () {
	// 		yield* sleep(1)
	// 		throw Error("SomeErrorTag")
	// 	}

	// })
})