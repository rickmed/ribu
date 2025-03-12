import { describe, it, expect } from "vitest"
import { go, sleep } from "../source/index.ts"
import { Err, isE } from "../source/errors.ts"
import { assertRibuErr, checkErrSpec } from "./utils.ts"


describe(`jobs blocks and resumes waiting for other jobs to finish`, () => {

	it("yield* the target job unblocks the caller job with its return value", async () => {

		function* child() {
			yield sleep(1)
			return "child one"
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main)
		expect(rec).toBe("child one")
	})

	it("using .err, caller job gets union of what target job returns and all possible errors", async () => {

		function* child() {
			yield sleep(1)
			return "child done"
		}

		function* main() {
			const res = yield* go(child).err
			if (isE(res)) {  // basic demo usage
				return res
			}
			return res
		}

		const rec = await go(main)
		expect(rec).toBe("child done")
	})
})

describe("Job Errors. Job settles with the right error when:", () => {

	it("using yield*", async () => {

		const exp = {
			name: "Err",
			fn: "main",
			message: "",
			cause: {
				name: "Err",
				fn: "inner",
				message: "",
				cause: {
					name: "Error",
					message: "boom",
				}
			},
		}

		function* main() {

			function* inner() {
				yield sleep(1)
				throw Error("boom")
			}

			yield* go(inner)
		}

		const rec = await go(main).pErr

		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
		expect(rec.cause).toBeInstanceOf(Err)
	})
})


describe("job can yield promises", () => {

	it("job gets resumed when promise resolves", async () => {

		function* main() {
			const res = (yield Promise.resolve(1)) as number
			return res
		}

		const rec = await go(main)
		expect(rec).toBe(1)
	})

	it("job fails with correct error when promise rejects", async () => {

		function* main() {
			const res = (yield Promise.reject("Bad")) as number
			return res
		}

		const rec = await go(main).promfyCont

		const exp = {
			fn: "main",
			cause: {
				name: "PromiseRejected",
				cause: "Bad",
			}
		}
		assertRibuErr(rec)
		checkErrSpec(rec, exp)
	})
})
