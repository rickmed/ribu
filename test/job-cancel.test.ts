import { describe, expect, it } from "vitest"
import { go, Err, sleep, onEnd, Job } from "ribu"
import { _Er, _E, ERR_CANC_OK } from "../source/errors.js"

function* child(ctx: { count: number }) {
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
	 * Use `.cancelHandleErr()` instead.
	 */
	it("returns Cancel OK Err if job cancelled ok", async () => {

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
		expect(rec).toStrictEqual(ERR_CANC_OK)
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
			_Er("main",
				_Er("child1",
					_Er("", Error("Bad")),
					"Cancelled"
				),
			)

		expect(ctx.count).toBe(0)
		expect(rec).toStrictEqual(exp)
	})

	it(".cancel() side effects only run once", async () => {

		let onEndCalledTimes = 0

		function* child1() {
			onEnd(function* end() {
				onEndCalledTimes++
				yield* sleep(2)
			})
			yield* sleep(5)
		}

		function* main() {
			const childJob = go(child1)
			yield* sleep(1)
			const firstCancelRes = yield* childJob.cancel()

			// Late cancel works with .cancel()
			const lateCancelRes1 = yield* childJob.cancel()

			// Late cancel works with .cancelHandleErr()
			const lateCancelRes2 = yield* childJob.cancelHandleErr()

			const childSettledVal = childJob.isDone() && childJob.val
			return { firstCancelRes, lateCancelRes1, lateCancelRes2, childSettledVal }
		}

		const { firstCancelRes, lateCancelRes1, lateCancelRes2, childSettledVal } = await go(main)
		expect(firstCancelRes).toStrictEqual(ERR_CANC_OK)
		expect(lateCancelRes1).toStrictEqual(ERR_CANC_OK)
		expect(lateCancelRes2).toStrictEqual(ERR_CANC_OK)
		expect(onEndCalledTimes).toBe(1)
		expect(childSettledVal).toStrictEqual(ERR_CANC_OK)
	})
})


/**
 * Handle unhappy paths manually.
 */
describe("yield* job.cancelHandleErr()", () => {

	it("user can recover from cancelling errors", async () => {

		function* child1() {
			onEnd(() => Err("Bad"))
			yield* sleep(3)
		}

		function* main() {
			const chld = go(child1)
			yield* sleep(1)
			const res = yield* chld.cancelHandleErr()
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
			return yield* chld.cancelHandleErr()
		}

		const rec = await go(main).promHandle
		expect(rec).toBe(ERR_CANC_OK)
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
			const rec = yield* chld.cancelHandleErr()
			return { rec }
		}

		const rec = await go(main).promHandle

		expect(ctx.count).toBe(0)

		const childSettleVal =
			_Er("child1",
				_Er("", Error("Bad")),
				"Cancelled")

		const exp = {
			rec: childSettleVal,
		}

		expect(rec).toEqual(exp)
	})
})