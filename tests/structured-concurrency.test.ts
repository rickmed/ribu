import { describe, expect, it } from "vitest"
import { Err, go, sleep } from "ribu"
import { _Err } from "./utils.ts"
import { GenFnErr, WaitingChldErr } from "../source/errors.ts"


describe("job auto-waits for children to finish", () => {

	it("if job returns and it has active children, it is blocked until its children are done", async () => {

		let jobsDone = 0

		function* child() {
			yield* sleep(2)
			jobsDone++
		}

		function* child2() {
			yield* sleep(2)
			jobsDone++
		}

		function* main() {
			go(child)
			go(child2)
			yield* sleep(1)
		}

		await go(main)
		expect(jobsDone).toBe(2)
	})

	it("if child job fails, parent cancels its siblings and is resolved with correct Error", async () => {

		let child2Finished = false

		function* child1() {
			yield* sleep(2)
			throw Error("Bad")
		}

		function* child2() {
			yield* sleep(3)
			child2Finished = true
		}

		function* main() {
			yield* sleep(1)
			go(child1)
			go(child2)
		}

		const rec = await go(main).promErr
		const exp = WaitingChldErr("main", GenFnErr("child1", Error("Bad")))
		expect(rec).toStrictEqual(exp)
		expect(child2Finished).toBe(false)
	})
})
