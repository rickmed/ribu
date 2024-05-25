import { describe, expect, it } from "vitest"
import { go, onEnd, cancel } from "../source/job.mjs"
import { sleep } from "../source/timers.mjs"
import { assertRibuErr, checkErrSpec } from "./utils.mjs"
//todo: test "Cancelled by " message.
describe(".cancel()", () => {

	it("a job can cancel another job", async () => {

		let childReturned = false

		function* main() {
			const chld = go(function* child() {
				yield sleep(4)
				childReturned = true
			})
			yield sleep(2)
			yield chld.cancel()
		}

		await go(main).promfy
		expect(childReturned).toBe(false)
	})

	it("when a job is cancelled, all its descendants are cancelled", async () => {

		let changed = 0

		const job = go(function* main() {

			const childJob = go(function* child() {

				go(function* grandChild() {
					yield sleep(3)
					changed++
				})

				yield sleep(3)
				changed++
			})

			yield sleep(1)
			yield childJob.cancel()
		})

		await job.promfy
		expect(changed).toBe(0)
	})

	it("when job to cancel is already settled ok, .cancel() is a noop", async () => {

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

	it("when job to cancel is already settled with failure, calling job fails with correct error", async () => {

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

describe.todo("using onEnds", () => {

	it("runs when job is cancelled")

	// function* job() {
	// 	onEnd(() => {

	// 	})
	// 	yield sleep(1)
	// }

	// function* main() {
	// 	yield* go(job).$

	// }
})

describe("cancel(jobs)", () => {

	it("a job can cancel an array of jobs succesfully", async () => {

		let childReturned = 0

		function* child1() {
			yield sleep(4)
			childReturned++
		}

		function* child2() {
			yield sleep(4)
			childReturned++
		}

		function* main() {
			const jobs = [go(child1), go(child2)]
			yield sleep(2)
			yield cancel(jobs)
		}

		await go(main).promfy
		expect(childReturned).toBe(0)
	})

	it("job calling cancel() resolves with correct error if a target job fails cancelling", async () => {

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
			yield sleep(3)
			childsReturned++
		}

		function* child2() {
			yield sleep(3)
			childsReturned++
		}

		function* main() {
			onEnd(() => {
				throw Error("main() clean-up after cancel fail")
			})
			const jobs = [go(child1), go(child2)]
			yield sleep(1)
			yield cancel(jobs)
		}

		const rec = await go(main).promfyCont

		expect(childsReturned).toBe(0)
		assertRibuErr(rec)
		checkErrSpec(rec, exp)
	})
})

describe.todo("deadlines", () => {
})
