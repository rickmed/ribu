import { describe, it, expect } from "vitest"
import { go, Ch, sleep } from "../source/index.mjs"
import { check_Eq, check_ThrowsAwait, sleep_p, range, assertsRibuE, goAndAwaitFn as goAndAwait, goAndAwaitFn as goAndAwait, assertErr as assertRibuErr } from "./utils.mjs"
import { E, ECancOK, Err, isE, type RibuE } from "../source/errors.mjs"
import { onEnd } from "../source/job.mjs"

describe("job timers", () => {

	it("can sleep() without blocking", async () => {

		let x = false

		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		go(function* job() {
			yield sleep(1)
			x = true
		})

		check_Eq(x, false)
		await sleep_p(2)
		check_Eq(x, true)
	})
})


describe(`jobs can be blocked ("await") for other jobs to finish`, () => {

	it("using .$", async () => {

		let done: boolean = false

		go(function* job() {
			done = yield* go(function* sleeper() {
				yield sleep(1)
				return true
			}).$
		})

		await sleep_p(2)
		check_Eq(done, true)
	})

	it("using .cont", async () => {

		let done: boolean = false

		go(function* main() {

			const res = yield* go(function* sleeper() {
				yield sleep(1)
				return true
			}).err

			if (res instanceof Error) { return res }
			else { return done = res }
		})

		await sleep_p(2)
		check_Eq(done, true)
	})
})


describe.skip("parent job auto-waits for children to finish", () => {

	it("if parent generator function returns and there are active children, the caller of the parent job is blocked until all descendants are finished", async () => {

		let jobsDone = 0

		await go(function* job() {

			yield* go(function* parent() {

				go(function* child1() {
					yield sleep(5)
					jobsDone++
				})
				go(function* child1() {
					yield sleep(5)
					jobsDone++
				})

				yield sleep(1)

			}).$
		})

		check_Eq(jobsDone, 2)
	})

	it("job resolves with correct Error if one child fails (while auto-waiting)", async () => {

		function* job() {

			yield* go(function* parent() {

				go(function* child1() {
					yield sleep(5)
				})
				go(function* child1() {
					yield sleep(2)
					throw Error("BOOM")
				})

				yield sleep(1)

			}).$
		}

		const err = await check_ThrowsAwait(goAndAwait(job))
		// check_Eq(jobsDone, 2)

	})
})

describe("job is thenable", () => {

	it("returns correct awaited value when job is successful", async () => {
		const job = go(function* other() {
			yield sleep(1)
			return "ok"
		})

		const res = await job
		check_Eq(res, "ok")
	})

	it("rejects with correct error when job failed", async () => {

		const exp = {
			name: "Err",
			_op: "main",
			message: "",
			cause: {
				name: "Error",
				message: "boom",
			}
		}

		function* main() {
			yield sleep(1)
			throw Error("boom")
		}

		const rec = await check_ThrowsAwait(goAndAwait(main))

		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
	})
})

describe("job cancellation", () => {

	it("a job can cancel another job", async () => {

		let isChanged = false

		go(function* main() {

			const job = go(function* other() {
				yield sleep(3)
				isChanged = true
			})

			yield sleep(1)
			yield* job.cancel()
		})

		await sleep_p(5)
		check_Eq(isChanged, false)
	})

	it.todo("when a job is cancelled all inner job tree")
})


describe("Job Errors. Job settles with the right error when:", () => {

	it("using yield* .$", async () => {

		const exp = {
			name: "Err",
			_op: "main",
			message: "",
			cause: {
				name: "Err",
				_op: "inner",
				message: "",
				cause: {
					name: "Error",
					message: "boom",
				}
			},
		}

		function* main() {

			function* inner() {
				yield sleep(1)
				throw Error("boom")
			}

			yield* go(inner).$
		}

		const rec = await go(main).toPromErr()

		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
		expect(rec.cause).toBeInstanceOf(Err)
	})

	it("user returns a type Error and an onEnd fails", async () => {

		const exp = {
			name: "Err",
			_op: "main",
			message: "",
			cause: {
				name: "Err",
				_op: "inner",
				message: "",
				cause: {
					name: "Error",
					message: "Fail path",
				},
				onEndErrors: [{
					message: "while cleaning",
					name: "Error",
				}],
			},
		}

		function* main() {
			function* inner() {
				onEnd(() => {
					throw Error("while cleaning")
				})
				yield sleep(1)
				return Error("Fail path")
			}

			yield* go(inner).$
		}

		const rec = await go(main).toPromErr()

		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
		expect(rec.cause).toBeInstanceOf(Err)
	})

	// it.only("mock test delete this", async () => {

	//    const rec = {
	//       name: "Err",
	//       _op: "main",
	//       message: "hola",
	//       cause: {
	//          name: "Err",
	//          _op: "inner",
	//          message: "",
	//       }
	//    }

	//    function isGood(a: unknown, v: string) {
	//       return [v === "hola", ``]
	//    }

	//    const exp = {
	//       name: "Err",
	//       _op: "main",
	//       message: satisfies(isGood, {}),
	//       cause: {
	//          name: "Err",
	//          _op: "inner",
	//          message: "",
	//       }
	//    }

	//    check(rec).with(exp)
	// })

})
