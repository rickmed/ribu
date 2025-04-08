import { describe, expect, it } from "vitest"
import { go, Err, sleep, onEnd } from "ribu"
import { _Err } from "../source/errors.js"

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

	/**
	 * NOTE:
	 * Users should NOT use plain `yield* cancel()` to handle the return value.
	 * Use `.cancelErr()` instead.
	 */
	it("returns undefined if job cancelled ok", async () => {

		let ctx = { count: 0 }

		function* child1() {
			onEnd(() => {
				return "ok"
			})
			yield* sleep(3)
			ctx.count++
		}

		function* main() {
			const chld = go(child1)
			yield* sleep(1)
			const res = yield* chld.cancel()
			return res
		}

		const rec = await go(main).promHandle
		expect(rec).toStrictEqual(undefined)
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

	it("caller fails if target fails cancelling", async () => {

		let ctx = { count: 0 }

		function* child1() {
			onEnd(() => {
				throw Error("Bad")
			})
			yield* sleep(4)
			ctx.count++
		}

		function* main() {
			const chld = go(child1)
			yield* sleep(2)
			yield* chld.cancel()
		}

		const rec = await go(main).promHandle

		const exp =
			_Err("main",
				_Err("child1",
					_Err("", Error("Bad")),
					"Cancelled"
				),
			)

		expect(ctx.count).toBe(0)
		expect(rec).toStrictEqual(exp)
	})

	/**
	 *  If a job is already settled, calling `.cancel()` won't change the state
	 *  of the target job. Even if the target job settled with errors, those
	 *  errors won't be propagated to the caller.
	 *
	 * NOTE:
	 *  Users should NOT use plain `yield* cancel()` to handle the return value.
	 *  Use `.cancelErr()` instead.
	 */
	it(".cancel() is a no-op on already settled jobs and returns undefined", async () => {

		function* child1() {
			yield* sleep(1)
			return Err("Bad")
		}

		function* main() {
			const childJob = go(child1)
			yield* sleep(3)
			const cancelRes = yield* childJob.cancel()
			return { cancelRes, childJob }
		}

		const { cancelRes, childJob } = await go(main)

		expect(cancelRes).toStrictEqual(undefined)

		const exp = Err("Bad", "child1")
		const rec = childJob.isDone() && childJob.val
		expect(rec).toStrictEqual(exp)
	})
})


/**
 * Handle unhappy paths manually.
 */
describe("yield* job.cancelErr()", () => {

	it("user can recover from cancelling errors", async () => {

		function* child1() {
			onEnd(() => Err("Bad"))
			yield* sleep(3)
		}

		function* main() {
			const chld = go(child1)
			yield* sleep(1)
			const res = yield* chld.cancelHandle()
			// Recovering: if res !== undefined, cancelling failed.
			if (res) {
				return "saved"
			}
			return "never reached"
		}

		const rec = await go(main).promHandle
		expect(rec).toEqual("saved")
	})

	it("returns undefined if target job cancelled ok", async () => {

		let ctx = { count: 0 }

		function* main() {
			const chld = go(child, ctx)
			yield* sleep(1)
			return yield* chld.cancelHandle()
		}

		const rec = await go(main).promHandle
		expect(rec).toBe(undefined)
		expect(ctx.count).toBe(0)
	})

	it("returns target job settle value if fails cancelling", async () => {

		let ctx = { count: 0 }

		function* child1() {
			onEnd(() => {
				throw Error("Bad")
			})
			yield* sleep(4)
			ctx.count++
		}

		function* main() {
			const chld = go(child1)
			yield* sleep(2)
			const rec = yield* chld.cancelHandle()
			return { rec }
		}

		const rec = await go(main).promHandle

		expect(ctx.count).toBe(0)

		const childSettleVal =
			_Err("child1",
				_Err("", Error("Bad")),
				"Cancelled")

		const exp = {
			rec: childSettleVal,
		}

		expect(rec).toEqual(exp)
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

		function* main() {
			const chldJob = go(child1)
			yield* sleep(3)
			const cancelRes = yield* chldJob.cancelHandle()
			return { cancelRes, chldJob }
		}

		const { cancelRes, chldJob } = await go(main)

		expect(cancelRes).toEqual(undefined)

		const exp = Err("Bad", "child1")
		const rec = chldJob.isDone() && chldJob.val
		expect(rec).toStrictEqual(exp)
	})
})