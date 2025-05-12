import { describe, it, expect } from "vitest"
import { Err, go, sleep, _Err } from "ribu"
import { _Er, _E, errIs } from "../source/errors.js"

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
			_Er("main",
				_E("Recovered", "child")
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
			_Er("main",
				_Er("child",
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
			_Er("main",
				_Er("child", "Bad")
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
			const res = yield* go(child).handleErr
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
			const res = yield* go(child).handleErr
			return res
		}

		const rec = await go(main).promHandle
		const exp = _E("Recovered", "child")
		expect(rec).toStrictEqual(exp)
	})

	it("caller job resumes if target fails via throwing ::Error", async () => {

		function* child() {
			yield* sleep(1)
			throw Error("Bad")
		}

		function* main() {
			const res = yield* go(child).handleErr
			return res
		}

		const rec = await go(main).promHandle
		const exp = _Er("child", Error("Bad"))
		expect(rec).toStrictEqual(exp)
	})

	it("caller job resumes if target fails via throwing non ::Error", async () => {

		function* child() {
			yield* sleep(1)
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw "Really Bad"
		}

		function* main() {
			const res = yield* go(child).handleErr
			return res
		}

		const rec = await go(main).promHandle
		const exp = _Er("child", "Really Bad")
		expect(rec).toStrictEqual(exp)
	})

	/* Demo of a few ways to create/type Errors in Ribu and handle them manually */
	it("caller job can handle ::Err", async () => {

		class Err3 extends _Err {
			readonly $err = "Err3"
			constructor(readonly w: number) {
				super()
			}
		}

		function* job1(x: string) {
			yield* sleep(1)
			if (x == "ok") {
				return true
			}
			if (x == "er0") {
				return Err("Err0")
			}
			if (x == "er1") {
				return Err("Err1", { y: false as const })
			}
			if (x == "er2") {
				const payload = { z: "no" as const }
				type Er2 = Err<"Err2"> & typeof payload
				return Err("Err2", payload) as Er2
			}
			return new Err3(0)
		}

		function* main() {
			let errs: ("Err0" | false | "no" | number)[] = []

			const res0 = yield* go(job1, "er0").handleErr
			if (errIs(res0, "Err0")) {
				errs.push(res0.$err)
			}

			const res1 = yield* go(job1, "er1").handleErr
			if (errIs(res1, "Err1")) {
				errs.push(res1.y)
			}

			const res2 = yield* go(job1, "er2").handleErr
			if (errIs(res2, "Err2")) {
				errs.push(res2.z)
			}

			const res3 = yield* go(job1, "er3").handleErr
			if (errIs(res3, "Err3")) {
				errs.push(res3.w)
			}

			return errs
		}

		const rec = await go(main).promHandle
		const exp = ["Err0", false, "no", 0]
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
		expect(job.st).toBe("running")

		await job

		expect(job.isOk() && job.val).toBe("allOk")
		expect(job.isDone() && job.val).toBe("allOk")
		expect(job.isErr()).toBe(false)
		expect(job.st).toBe("ok")
	})

	it("failed job", async () => {

		function* badJob () {
			yield* sleep(1)
			return Err("Bad")
		}

		const job = go(badJob)
		expect(job.isDone()).toBe(false)
		expect(job.isOk()).toBe(false)
		expect(job.isErr()).toBe(false)
		expect(job.st).toBe("running")

		await job.promHandle

		const errRes = _E("Bad", "badJob")
		expect(job.isErr() && job.reason).toStrictEqual(errRes)
		expect(job.isDone() && job.val).toStrictEqual(errRes)
		expect(job.isOk()).toBe(false)
		expect(job.st).toBe("err")

	})
})