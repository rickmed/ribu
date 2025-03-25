import { describe, it, expect } from "vitest"
import { go, sleep, onEnd, Err } from "ribu"
import { sleepProm } from "./utils.js"
import { _Err } from "../source/errors.js"


it("can run sync functions, async functions and job generator functions." +
	"Are executed sequentially and in reverse order of registration", async () => {

	let onEnds: string[] = []

	function* main() {

		onEnd(() => {
			onEnds.push("sync")
		})

		onEnd(async () => {
			onEnds.push("async")
			const sleepMs = random(0, 10)
			await sleepProm(sleepMs)
		})

		onEnd(function* () {
			onEnds.push("job")
			const sleepMs = random(0, 10)
			yield* sleep(sleepMs)
		})

		yield* sleep(1)
	}

	await go(main)
	expect(onEnds).toStrictEqual(["job", "async", "sync"])
})

it.only("job fails with correct Err if onEnd fails", async () => {

	function* main() {

		onEnd(function badSync() {
			return Err("BadSync")
		})

		yield* sleep(1)
	}

	const rec = await go(main).promErr
	const exp = _Err("main")._addOnEndErr(Err("BadSync", "badSync"))
	expect(rec).toStrictEqual(exp)
})


it("job executes all onEnds even if some of them fail. " +
	"Settles with correct Err", async () => {

	function* main() {

		let finished: string[] = []

		onEnd(function badSync() {
			return Err("BadSync")
		})

		onEnd(() => {
			finished.push("sync")
		})

		onEnd(function* badJob() {
			yield* sleep(1)
			return Err("BadJob")
		})

		onEnd(function* () {
			yield* sleep(1)
			finished.push("job")
		})

		onEnd(async function badAsync() {
			await sleepProm(1)
			throw Error("BadAsync")
		})

		onEnd(async () => {
			await sleepProm(1)
			finished.push("async")
		})

		yield* sleep(1)
	}

	const rec = await go(main).promErr
	lg(rec)
	expect(rec).toStrictEqual(Error)
})


describe.skip("using yield* job.cancelErr(), user can handle cancellation errors", () => {

	it("a job stops execution when cancelled", async () => {

		let childReturned = 0

		function* child() {
			yield* sleep(4)
			childReturned++
		}

		function* main() {
			const chld = go(child)
			yield* sleep(2)
			yield* chld.cancelErr()
		}

		await go(main)
		expect(childReturned).toBe(0)
	})

	it("when a job is cancelled, all its descendants stop execution", async () => {

		let childReturned = 0

		function* grandChild() {
			yield* sleep(2)
			childReturned++
		}

		function* child() {
			const grandChildJob = go(grandChild)
			yield* sleep(2)
			yield* grandChildJob
			childReturned++
		}

		function* main() {
			const childJob = go(child)
			yield* sleep(1)
			yield* childJob.cancel()
		}

		await go(main)
		expect(childReturned).toBe(0)
	})

	it("when job to cancel is already settled, .cancel() has no effect and returns the original value", async () => {

		const err = Err("even if job ended with error")

		function* child() {
			yield* sleep(1)
			return err
		}

		function* main() {
			const chld = go(child)
			yield* sleep(2)
			yield* chld.cancel()
			return chld.val
		}

		const rec = await go(main).promErr
		expect(rec).not.toBe(CANC_OK)
		expect(rec).toEqual(err)
	})
})

describe.todo("with cancel(...jobs)", () => {

	it("a job can cancel several jobs concurrently", async () => {

	})

})




function random(min: number, max: number) {
	return Math.floor(Math.random() * (max - min) + min)
}