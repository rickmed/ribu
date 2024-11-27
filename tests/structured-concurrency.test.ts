import { describe, expect, it } from "vitest"
import { go, sleep } from "../source/index.js"
import { assertRibuErr, checkErrSpec } from "./utils.js"

describe("job auto-waits for children to finish", () => {

	it("if generator function returns and there are active children, it is blocked until its children are done", async () => {

		let childsDone = 0

		function* child() {
			yield sleep(2)
			childsDone++
		}

		function* main() {
			go(child)
			go(child)
			yield sleep(1)
		}

		await go(main).promfy
		expect(childsDone).toBe(2)
	})

	it("if child job fails, parent cancels its siblings and it's resolved with correct Error", async () => {

		const exp = {
			_op: "main",
			cause: {
				_op: "child1",
				cause: {
					name: "Error",
					message: "Bad",
				}
			}
		}

		let child2Finished = false

		function* child1() {
			yield sleep(2)
			throw Error("Bad")
		}

		function* child2() {
			yield sleep(3)
			child2Finished = true
		}

		function* main() {
			yield sleep(1)
			go(child1)
			go(child2)
		}

		const rec = await go(main).promfyCont

		expect(child2Finished).toBe(false)
		assertRibuErr(rec)
		checkErrSpec(rec, exp)
	})
})
