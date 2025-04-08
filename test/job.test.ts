import { describe, it, expect } from "vitest"
import { Err, go, sleep, errIs } from "ribu"
import { _Err, isErr } from "../source/errors.js"

describe("yield*", () => {

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
})

describe("yield* automatic error propagation", () => {

	it("if target job returns ::Err, the name of the function is added to it and" +
		"the caller propagates the error wrapped in its own ::Err", async () => {

		function* child() {
			yield* sleep(1)
			return Err("Recovered")
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main).promHandle
		const exp =
			_Err("main",
				Err("Recovered", "child")
			)
		expect(rec).toStrictEqual(exp)
	})

	it("if target job throws ::Error, caller propagates the error wrapped in its" +
		"own ::Err", async () => {

		function* child() {
			yield* sleep(1)
			throw Error("SomeErrorTag")
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main).promHandle
		const exp =
			_Err("main",
				_Err("child",
					Error("SomeErrorTag")
				)
			)
		expect(rec).toStrictEqual(exp)
	})


	it("if target job throws not ::Error, caller propagates the error wrapped" +
		"in its own ::Err", async () => {

		function* child() {
			yield* sleep(1)
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw "Bad"
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main).promHandle
		const exp =
			_Err("main",
				_Err("child", "Bad")
			)
		expect(rec).toStrictEqual(exp)
	})
})


/**
 * Handle errors manually.
 */
describe("yield* job.handle", () => {

	it("caller job resumes if target does not fail", async () => {

		function* child() {
			yield* sleep(1)
			return "ok"
		}

		function* main() {
			const res = yield* go(child).handle
			return res
		}

		const rec = await go(main)
		expect(rec).toBe("ok")
	})

	it("caller job resumes if target fails via returning ::Err", async () => {

		function* child() {
			yield* sleep(1)
			return Err("Recovered")
		}

		function* main() {
			const res = yield* go(child).handle
			return res
		}

		const rec = await go(main).promHandle
		const exp = Err("Recovered", "child")
		expect(rec).toStrictEqual(exp)
	})

	it("caller job resumes if target fails via throwing ::Error", async () => {

		function* child() {
			yield* sleep(1)
			throw Error("Bad")
		}

		function* main() {
			const res = yield* go(child).handle
			return res
		}

		const rec = await go(main).promHandle
		const exp = _Err("child", Error("Bad"))
		expect(rec).toStrictEqual(exp)
	})

	it("caller job resumes if target fails via throwing non ::Error", async () => {

		function* child() {
			yield* sleep(1)
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw "Really Bad"
		}

		function* main() {
			const res = yield* go(child).handle
			return res
		}

		const rec = await go(main).promHandle
		const exp = _Err("child", "Really Bad")
		expect(rec).toStrictEqual(exp)
	})

	it("caller job can handle ::Err", async () => {

		function* job1(x?: number) {
			yield* sleep(1)
			if (!x) {
				return "ok"
			}
			if (x < 10) {
				return Err("Error0")
			}
			return Err("Error1")
		}

		function* main() {
			const res = yield* go(job1, 5).handle
			if (isErr(res)) {
				return res.Err("Recovered")
			}
			return res
		}

		const rec = await go(main).promHandle
		const exp =
			Err("Recovered", "main", undefined,
				Err("Error0", "job1")
			)
		expect(rec).toStrictEqual(exp)
	})



})

// todo
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