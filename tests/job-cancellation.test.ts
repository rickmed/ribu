import { describe, expect, it } from "vitest"
import { go, onEnd, cancel, CANC_OK, Err } from "../source/index.ts"
import { sleep } from "../source/timers.ts"
import { assertRibuErr } from "./utils.ts"


/* To handle cancel errors manually, use:
	job.cancel()
	const res = yield* job.err

	todo: add test.
*/

describe("job.cancel()", () => {

	it("a job stops execution when cancelled", async () => {

		let childReturned = 0

		function* child() {
			yield sleep(4)
			childReturned++
		}

		function* main() {
			const chld = go(child)
			yield sleep(2)
			yield chld.cancel()
		}

		await go(main)
		expect(childReturned).toBe(0)
	})

	it("when a job is cancelled, all its descendants stop execution", async () => {

		let childReturned = 0

		function* grandChild() {
			yield sleep(2)
			childReturned++
		}

		function* child() {
			const grandChildJob = go(grandChild)
			yield sleep(2)
			yield* grandChildJob
			childReturned++
		}

		function* main() {
			const childJob = go(child)
			yield sleep(1)
			yield childJob.cancel()
		}

		await go(main)
		expect(childReturned).toBe(0)
	})

	it("when job to cancel is already settled, .cancel() has no effect and returns the original value", async () => {

		const err = Err("even if job ended with error")

		function* child() {
			yield sleep(1)
			return err
		}

		function* main() {
			const chld = go(child)
			yield sleep(2)
			yield chld.cancel()
			return chld.val
		}

		const rec = await go(main).promErr
		expect(rec).not.toStrictEqual(CANC_OK)
		expect(rec).toEqual(err)
	})
})


describe.todo("yield* job.cancelErr()", () => {
})


describe.skip("cancel(jobs)", () => {

	it("a job can cancel an array of jobs succesfully", async () => {

		let childReturned = 0

		function* child1() {
			yield* sleep(4)
			childReturned++
		}

		function* child2() {
			yield* sleep(4)
			childReturned++
		}

		function* main() {
			const jobs = [go(child1), go(child2)]
			yield* sleep(2)
			yield* cancel(jobs)
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
