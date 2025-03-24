import { describe, expect, it } from "vitest"
import { go, cancel, CANC_OK, Err, sleep, Job } from "ribu"

function* child(ctx: {count: number}) {
	yield* sleep(3)
	ctx.count++
}

describe("job.cancel()", () => {

	it("a job stops execution when cancelled", async () => {

		let ctx = { count: 0 }

		function* main() {
			const chld = go(child, ctx)
			yield* sleep(1)
			yield* chld.cancel()
		}

		await go(main)
		expect(ctx.count).toBe(0)
	})

	it("when a job is cancelled, all its descendants stop execution", async () => {

		let ctx = { count: 0 }

		function* parent() {
			const grandChildJob = go(child, ctx)
			yield* sleep(2)
			yield* grandChildJob
			ctx.count++
		}

		function* main() {
			const job = go(parent)
			yield* sleep(1)
			yield* job.cancel()
		}

		await go(main)
		expect(ctx.count).toBe(0)
	})

	it("when job to cancel is already settled, .cancel() is a noop", async () => {
		// Even if job had errors in its main generator function

		function* child1() {
			yield* sleep(1)
			return Err("")
		}

		let chldJob!: Job

		function* main() {
			chldJob = go(child1)
			yield* sleep(2)
			yield* chldJob.cancel()
			return "error NOT propagated"
		}

		const rec = await go(main).promErr
		expect(rec).toEqual("error NOT propagated")
		expect(chldJob.val).not.toBe(CANC_OK)
	})
})


describe("cancel(jobs)", () => {

	it("a job can cancel several jobs concurrently", async () => {

		let ctx = { count: 0 }

		function* child2(ctx: {count: number}) {
			yield* sleep(3)
			ctx.count++
		}

		function* main() {
			const job1 = go(child, ctx)
			const job2 = go(child2, ctx)
			yield* sleep(1)
			yield* cancel(job1, job2)
		}

		await go(main)
		expect(ctx.count).toBe(0)
	})

	it("yield* cancel(...jobs) returns undefined if all jobs finished their" +
		"cancellation without errors", async () => {
		// But users should never use cancel() like this.
		// They should use cancel(...jobs).err to check for errors.

		let ctx = { count: 0 }

		function* child2(ctx: {count: number}) {
			yield* sleep(3)
			ctx.count++
		}

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
})
