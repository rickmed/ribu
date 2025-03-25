import { describe, expect, it } from "vitest"
import { go, CANC_OK, Err, sleep, Job } from "ribu"

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

	/**
	 * If a job is already settled, calling `.cancel()` won't change the state of
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
			yield* sleep(3)
			yield* chldJob.cancel()
			return "ok"
		}

		const rec = await go(main).promErr
		expect(rec).toEqual("ok")
		expect(chldJob.val).toStrictEqual(Err("Bad", "child1"))
	})
})
