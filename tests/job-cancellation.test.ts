import { describe, expect, it } from "vitest"
import { go, onEnd, cancel, CANC_OK, Err, sleep, Job } from "ribu"

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
		expect(chldJob.val).not.toStrictEqual(CANC_OK)
	})
})


describe.skip("cancel(jobs)", () => {

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

	it.skip("job calling cancel() resolves with correct error if a target job fails cancelling", async () => {

		const exp = {
			_op: "main",
			errors: [{
				_op: "child1",
				message: "Cancelled by main",
				errors: [{
					name: "Error",
					message: "clean-up after cancel"
				}]
			}, {
				name: "Error",
				message: "main() clean-up after cancel fail"
			}]
		}

		let childsReturned = 0

		function* child1() {
			onEnd(() => {
				throw Error("clean-up after cancel")
			})
			yield* sleep(3)
			childsReturned++
		}

		function* child2() {
			yield* sleep(3)
			childsReturned++
		}

		function* main() {
			onEnd(() => {
				throw Error("main() clean-up after cancel fail")
			})
			const jobs = [go(child1), go(child2)]
			yield* sleep(1)
			yield* cancel(jobs)
		}

		const rec = await go(main).promfyCont

		expect(childsReturned).toBe(0)
		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
		expect(rec.cause).toBeInstanceOf(_Err)
	})
})
