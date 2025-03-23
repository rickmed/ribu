import { describe, it, expect } from "vitest"
import { go, sleep, onEnd } from "ribu"
import { sleepProm } from "./utils.js"


describe.skip("onEnds run just before job is settled", () => {

	it("Works with sync fn, async fn and job. Are executed in reverse/sequential" +
		"order", async () => {

		let onEnds: string[] = []

		function* main() {

			onEnd(() => {
				onEnds.push("sync cleanup")
			})

			onEnd(async () => {
				onEnds.push("async cleanup")
				await sleepProm(1)
			})

			onEnd(function* () {
				onEnds.push("job cleanup")
				yield* sleep(1)
			})

			onEnd(() => go(function* () {
				onEnds.push("job2 cleanup")
				yield* sleep(1)
			}))

			yield* sleep(1)
		}

		await go(main)
		expect(onEnds).toStrictEqual(["job2 cleanup", "job cleanup", "async cleanup", "sync cleanup"])
	})
})



describe.todo("using yield* job.cancelErr(), user can handle cancellation errors", () => {

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
		expect(rec).not.toStrictEqual(CANC_OK)
		expect(rec).toEqual(err)
	})
})