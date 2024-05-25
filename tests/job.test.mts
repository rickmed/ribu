import { describe, it, expect } from "vitest"
import { go, onEnd, sleep } from "../source/index.mjs"
import { Err, isE } from "../source/errors.mjs"
import { assertRibuErr, checkErrSpec, sleepProm } from "./utils.mjs"


describe(`jobs can be blocked waiting for other jobs to finish`, () => {

	it("using .$, the target job unblocks the caller job with its return value", async () => {

		function* child() {
			yield sleep(1)
			return "child one"
		}

		function* main() {
			const res = yield* go(child).$
			return res
		}

		const rec = await go(main).promfy
		expect(rec).toBe("child one")
	})

	it("using .cont, the target job unblocks the caller job with its return value, including possible errors", async () => {

		function* child() {
			yield sleep(1)
			return "child done"
		}

		function* main() {
			const res = yield* go(child).cont
			if (isE(res)) {  // just to demo basic usage
				return res
			}
			return res
		}

		const rec = await go(main).promfy
		expect(rec).toBe("child done")
	})
})

describe("Job Errors. Job settles with the right error when:", () => {

	it("using yield* .$", async () => {

		const exp = {
			name: "Err",
			_op: "main",
			message: "",
			cause: {
				name: "Err",
				_op: "inner",
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

			yield* go(inner).$
		}

		const rec = await go(main).promfyCont

		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
		expect(rec.cause).toBeInstanceOf(Err)
	})
})

describe("onEnds run when job's generator function returns", () => {

	it("works with sync fn, async fn and job. Are executed in reverse added order", async () => {

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
				yield sleep(1)
			})

			onEnd(() => go(function* () {
				onEnds.push("job2 cleanup")
				yield sleep(1)
			}).timeout(3))

			yield sleep(1)
		}

		await go(main).promfy
		expect(onEnds).toStrictEqual(["job2 cleanup", "job cleanup", "async cleanup", "sync cleanup"])
	})
})

describe("job can yield promises", () => {

	it("job gets resumed when promise resolves", async () => {

		function* main() {
			const res = (yield Promise.resolve(1)) as number
			return res
		}

		const rec = await go(main).promfyCont
		expect(rec).toBe(1)
	})

	it("job fails with correct error when promise rejects", async () => {

		function* main() {
			const res = (yield Promise.reject("Bad")) as number
			return res
		}

		const rec = await go(main).promfyCont

		const exp = {
			_op: "main",
			cause: "Bad"
		}
		assertRibuErr(rec)
		checkErrSpec(rec, exp)	})
})
