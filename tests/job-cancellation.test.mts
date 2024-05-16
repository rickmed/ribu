import { describe, expect, it } from "vitest"
import { go, onEnd } from "../source/job.mjs"
import { sleep } from "../source/timers.mjs"
import { assertRibuErr, checkErrSpec } from "./utils.mjs"

describe("basics", () => {

	it("a job can cancel another job", async () => {

		let changed = false

		function* main() {

			const chld = go(function* child() {
				yield sleep(2)
				changed = true
			})

			yield sleep(1)
			yield chld.cancel()
		}

		await go(main).promfy
		expect(changed).toBe(false)
	})

	it("works correctly when job to cancel is already settled", async () => {

		function* main() {

			const chld = go(function* child() {
				yield sleep(1)
				return "child done"
			})

			yield sleep(2)
			yield chld.cancel()
			return [chld.val, "main done"]
		}

		const rec = await go(main).promfy
		expect(rec).toStrictEqual(["child done", "main done"])
	})

	it("when a job is cancelled, all its descendants are cancelled", async () => {

		let changed = 0

		const job = go(function* main() {

			const childJob = go(function* child() {

				go(function* grandChild() {
					yield sleep(2)
					changed++
				})

				yield sleep(2)
				changed++
			})

			yield sleep(1)
			yield childJob.cancel()
		})

		await job.promfy
		expect(changed).toBe(0)
	})

	it("cancelling job fails with correct error if job to cancel is settled with error", async () => {

		const exp = {
			_op: "main",
			cause: {
				_op: "child",
				cause: {
					name: "Error",
					message: "Bad",
				}
			}
		}

		function* main() {

			const chld = go(function* child() {
				yield sleep(1)
				return Error("Bad")
			})

			yield sleep(2)
			yield chld.cancel()
			return true
		}

		const rec = await go(main).promfyCont
		assertRibuErr(rec)
		checkErrSpec(rec, exp)
	})
})

describe("using onEnds", () => {

	it("runs when job is cancelled")

	function* job() {
		onEnd(() => {

		})
		yield sleep(1)
	}

	function* main() {
		yield* go(job).$

	}



})

describe.todo("deadlines", () => {
})
