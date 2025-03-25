import { describe, it, expect } from "vitest"
import { go, cancel, sleep, Err, Job, onEnd } from "ribu"
import { child, child2 } from "./utils.js"
import { _Err } from "../source/errors.js"
import { CANCEL_ALL_TIMEOUT } from "../source/job.js"


describe("yield* cancel(...jobs)", () => {

	it("cancels several jobs concurrently", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(child, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			yield* cancel(job1, job2)
		}

		await go(main)
		expect(ctx.count).toBe(0)
	})

	/**
	 * NOTE:
	 * Users should NOT use plain `yield* cancel()` to handle the return value.
	 * Use `.err` instead.
	 */
	it("returns undefined if all jobs finished their cancellation without errors", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(child, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			const res = yield* cancel(job1, job2)
			return res
		}

		const rec = await go(main).promErr
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
			yield* sleep(1)
			return Err("Bad")
		}

		let chldJob!: Job

		function* main() {
			chldJob = go(child1)
			yield* sleep(2)
			yield* cancel(chldJob)
			return "ok"
		}

		const rec = await go(main).promErr
		expect(rec).toEqual("ok")
		expect(chldJob.val).toStrictEqual(Err("Bad", "child1"))
	})
})

describe("cancel(...jobs).maxWait(ms)", () => {

	/**
	 * NOTE:
	 * Users should NOT use plain `yield* cancel()` to handle the return value.
	 * Use `.err` instead.
	 */
	it("returns undefined if all jobs finished their cancellation on time and " +
		"without errors", async () => {

		let ctx = { count: 0 }

		function* main() {
			const job1 = go(child, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			const res = yield* cancel(job1, job2).maxWait(10)
			return res
		}

		const rec = await go(main).promErr
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
			yield* cancel(job1, job2).maxWait(2)
		}

		const rec = await go(main).promErr
		const exp = _Err("main", CANCEL_ALL_TIMEOUT)
		expect(rec).toStrictEqual(exp)
		expect(ctx.count).toBe(0)
	})
})
