import { describe, it } from "vitest"
import { go, sleep, onEnd } from "../source/index.js"
import { assertRibuErr, checkErrSpec } from "./utils.js"

describe("non-cancellation scenarios", () => {

	it("user returns a type Error and an onEnd fails", async () => {

		const exp = {
			_op: "main",
			cause: {
				_op: "child",
				cause: {
					name: "Error",
					message: "Fail path",
				},
				errors: [{
					name: "Error",
					message: "while cleaning",
				}],
			},
		}

		function* main() {
			function* child() {
				onEnd(() => {
					throw Error("while cleaning")
				})
				yield sleep(1)
				return Error("Fail path")
			}

			yield* go(child).$
		}

		const rec = await go(main).promfyCont

		assertRibuErr(rec)
		checkErrSpec(rec, exp)
	})
})
