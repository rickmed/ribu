import { describe, it, expect } from "vitest"
import { go, cancel, sleep, Err, Job, onEnd } from "ribu"
import { incCountOnDoneJob, child2, sleepProm } from "./utils.js"
import { _Er, _E } from "../source/errors.js"
import { CANCEL_ALL_OP_NAME } from "../source/cancelAllJobs.js"
import { TIME_OUT } from "../source/job-helpers.js"
import { _Job } from "../source/job.js"

describe("yield* cancel(...jobs)", () => {

	it("cancels several jobs concurrently", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(incCountOnDoneJob, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			yield* cancel([job1, job2])
		}

		await go(main)
		expect(ctx.count).toBe(0)
	})

	/**
	 * NOTE:
	 * Users should NOT use plain `yield* cancel()` to handle the return value.
	 * Use `.handle` instead.
	 */
	it("returns undefined if all jobs finished their cancellation without errors", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(incCountOnDoneJob, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			const res = yield* cancel([job1, job2])
			return res
		}

		const rec = await go(main).promHandle
		expect(ctx.count).toBe(0)
		expect(rec).toBe(undefined)
	})

	/**
	 * If a job is already settled, calling `cancel()` won't change the state of
	 * the target job.
	 * Also, even if the target job settled with errors, those errors won't be
	 * propagated to the caller.
	 */
	it(".cancel() is a no-op on already settled jobs", async () => {

		function* child1() {
			yield* sleep(2)
			return Err("Bad")
		}

		let chldJob!: Job

		function* main() {
			chldJob = go(child1)
			yield* sleep(4)
			const res = yield* cancel([chldJob])
			return res
		}

		const rec = await go(main).promHandle
		expect(rec).toEqual(undefined)
		const exp = _E("Bad", "child1")
		expect((chldJob as _Job)._v).toStrictEqual(exp)
	})
})


/**
 * Handle unhappy paths manually.
 */
describe("yield* cancel(...jobs).handle", () => {

	it("returns undefined if all jobs cancelled ok", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(incCountOnDoneJob, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			const res = yield* cancel([job1, job2]).handle
			return res
		}

		const rec = await go(main).promHandle
		expect(ctx.count).toBe(0)
		expect(rec).toBe(undefined)
	})

	it("user can recover from cancelling errors", async () => {

		let ctx = { count: 0 }

		function* badChild(ctx: {count: number}) {
			onEnd(() => Err("Bad"))
			yield* sleep(3)
			ctx.count++
		}

		function* main() {
			const job1 = go(incCountOnDoneJob, ctx)
			const job2 = go(badChild, ctx)
			yield* sleep(1)
			const res = yield* cancel([job1, job2]).handle
			// Recovering: if res !== undefined, cancelling failed.
			if (res) {
				return "recovered"
			}
			return "never reached"
		}

		const rec = await go(main).promHandle
		expect(rec).toBe("recovered")
		expect(ctx.count).toBe(0)
	})

	it("returns accumulated errors of jobs' cancellation failures", async () => {

		let ctx = { count: 0 }

		function* syncBad1() {
			onEnd(() => Err("SyncBad1"))
			yield* sleep(5)
			ctx.count++
		}

		function* syncBad2() {
			onEnd(() => {
				throw Error("SyncBad2")
			})

			yield* sleep(5)
			ctx.count++
		}

		function* syncOk() {
			onEnd(() => {
				return "ok"
			})

			yield* sleep(5)
			ctx.count++
		}

		function* jobBad1() {
			onEnd(function* jobBad1OE() {
				yield* sleep(2)
				return Err("JobBad1")
			})

			yield* sleep(5)
			ctx.count++
		}

		function* jobBad2() {
			onEnd(function* jobBad2OE() {
				yield* sleep(4)
				throw Error("JobBad2")
			})

			yield* sleep(5)
			ctx.count++
		}

		function* jobOk() {
			onEnd(function* () {
				yield* sleep(6)
				return "ok"
			})

			yield* sleep(5)
			ctx.count++
		}

		function* AsyncBad() {
			onEnd(async () => {
				await sleepProm(8)
				throw new Error("AsyncBad")
			})

			yield* sleep(5)
			ctx.count++
		}

		function* AsyncOk() {
			onEnd(async () => {
				await sleepProm(10)
				return "ok"
			})

			yield* sleep(5)
			ctx.count++
		}

		function* main() {
			const children = [
				syncBad1, syncBad2, syncOk,
				jobBad1, jobBad2, jobOk,
				AsyncBad, AsyncOk,
			]
			const jobs = children.map(go)
			yield* sleep(1)
			const res = yield* cancel(jobs).handle
			return res
		}

		const rec = await go(main).promHandle
		expect(ctx.count).toBe(0)

		const exp =
			_Er(CANCEL_ALL_OP_NAME, [
				_Er("syncBad1",
					_E("SyncBad1"),
					"Cancelled"),

				_Er("syncBad2",
					_Er("", Error("SyncBad2")),
					"Cancelled"),

				_Er("jobBad1",
					_E("JobBad1", "jobBad1OE"),
					"Cancelled"),

				_Er("jobBad2",
					_Er("jobBad2OE", Error("JobBad2")),
					"Cancelled"),

				_Er("AsyncBad",
					_Er("", Error("AsyncBad")),
					"Cancelled"),
			])

		expect(rec).toStrictEqual(exp)
	})

	/**
	 * If a job is already settled, calling `cancel()` won't change the state of
	 * the target job.
	 * Also, even if the target job settled with errors, those errors won't be
	 * propagated to the caller.
	 */
	it("is a no-op on already settled jobs", async () => {

		function* child1() {
			yield* sleep(1)
			return Err("Bad")
		}

		let chldJob!: Job

		function* main() {
			chldJob = go(child1)
			yield* sleep(2)
			const cancelThing = cancel([chldJob]).handle
			yield* cancelThing
			return "ok"
		}

		const rec = await go(main).promHandle
		expect(rec).toEqual("ok")
		const exp = _E("Bad", "child1")
		expect((chldJob as _Job)._v).toStrictEqual(exp)
	})
})

describe("cancel(...jobs).maxWait(ms)", () => {

	/**
	 * NOTE:
	 * Users should NOT use plain `yield* cancel()` to handle the return value.
	 * Use `.handle` instead.
	 */
	it("returns undefined if all jobs finished their cancellation on time and " +
		"without errors", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(incCountOnDoneJob, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			const res = yield* cancel([job1, job2]).maxWait(10)
			return res
		}

		const rec = await go(main).promHandle
		expect(ctx.count).toBe(0)
		expect(rec).toBe(undefined)
	})

	it("caller fails if all jobs don't finish their cancellation on time", async () => {

		let ctx = { count: 0 }

		function* child1() {
			onEnd(function* () {
				yield* sleep(5)
			})

			yield* sleep(5)
			ctx.count++
		}

		function* child2() {
			onEnd(function* () {
				yield* sleep(5)
			})

			yield* sleep(5)
			ctx.count++
		}

		function* main() {
			const job1 = go(child1)
			const job2 = go(child2)
			yield* sleep(1)
			yield* cancel([job1, job2]).maxWait(2)
		}

		const rec = await go(main).promHandle
		const exp =
			_Er("main",
				_E(TIME_OUT, CANCEL_ALL_OP_NAME)
			)
		expect(rec).toStrictEqual(exp)
		expect(ctx.count).toBe(0)
	})
})


/**
 * Handle cancel timeouts manually.
 */
describe("cancel(...jobs).maxWait(ms).handle", () => {

	/**
	 * NOTE:
	 * Users should NOT use plain `yield* cancel()` to handle the return value.
	 * Use `.handle` instead.
	 */
	it("returns undefined if all jobs finished their cancellation on time and " +
		"without errors", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(incCountOnDoneJob, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			const res = yield* cancel([job1, job2]).maxWait(10).handle
			return res
		}

		const rec = await go(main).promHandle
		expect(ctx.count).toBe(0)
		expect(rec).toBe(undefined)
	})

	it("returns Timeout if all jobs don't finish their cancellation on time", async () => {

		let ctx = { count: 0 }

		function* child1() {
			onEnd(function* () {
				yield* sleep(5)
			})

			yield* sleep(5)
			ctx.count++
		}

		function* child2() {
			onEnd(function* () {
				yield* sleep(5)
			})

			yield* sleep(5)
			ctx.count++
		}

		function* main() {
			const job1 = go(child1)
			const job2 = go(child2)
			yield* sleep(1)
			const res = yield* cancel([job1, job2]).maxWait(2).handle
			return res
		}

		const rec = await go(main).promHandle
		const exp = _E(TIME_OUT, CANCEL_ALL_OP_NAME)
		expect(rec).toStrictEqual(exp)
		expect(ctx.count).toBe(0)
	})
})