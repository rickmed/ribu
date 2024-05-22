import { describe, expect, it } from "vitest"
import { go, sleep } from "../source/index.mjs"
import { allDone, allOneFail, first } from "../source/job-helpers.mjs"
import { assertRibuErr, checkErrSpec, sleepProm } from "./utils.mjs"
import { isE } from "../source/errors.mjs"

describe("allOneFail()", () => {

	it("waits for jobs concurrently and return their results in an array", async () => {

		let res: Array<string| number> = []

		function* job1() {
			yield sleep(2)
			return "job1"
		}

		function* job2() {
			yield sleep(2)
			return 2
		}

		function* main() {
			res = yield* allOneFail(go(job1), go(job2)).$
			yield sleep(1)
		}

		go(main)
		// sleepProm(3) ensures that job1 and job2 are ran concurrently
		await sleepProm(3)
		expect(res).toStrictEqual(["job1", 2])
	})

	it("settles with correct error with a passed in job fails and jo1 is cancelled", async () => {

		const exp = {
			_op: "main",
			cause: {
				_op: "_a1f",
				name: "AllOneFail",
				cause: {
					_op: "job2",
					cause: {
						name: "Error",
						message: "pow",
					}
				}
			},
		}

		function* job1() {
			yield sleep(2)
			return "job1"
		}

		function* job2() {
			yield sleep(2)
			throw Error("pow")
		}

		function* main() {
			const res = yield* allOneFail(go(job1), go(job2)).cont
			yield sleep(1)
			return res
		}

		const rec = await go(main).promfyCont

		assertRibuErr(rec)
		checkErrSpec(rec, exp)

	})
})

describe("allDone()", () => {

	it("waits for jobs concurrently and return their results in an array", async () => {

		let res: Array<string| number> = []

		function* job1() {
			yield sleep(2)
			return "job1"
		}

		function* job2() {
			yield sleep(2)
			return 2
		}

		function* main() {
			res = yield* allDone(go(job1), go(job2)).$
			yield sleep(1)
		}

		go(main)
		// sleepProm(3) ensures that job1 and job2 are ran concurrently
		await sleepProm(3)
		expect(res).toStrictEqual(["job1", 2])
	})

	it("settles with correct error with a passed in job fails", async () => {

		function* job1() {
			yield sleep(2)
			return "job1"
		}

		function* job2() {
			yield sleep(2)
			throw Error("pow")
		}

		function* main() {
			const res = yield* allDone(go(job1), go(job2)).cont
			yield sleep(1)
			return res
		}

		const rec = await go(main).promfyCont

		if (isE(rec)) {
			throw Error("test failed")
		}

		expect(rec[0]).toBe("job1")

		const exp = {
			_op: "job2",
			cause: {
				name: "Error",
				message: "pow",
			}
		}
		assertRibuErr(rec[1])
		checkErrSpec(rec[1], exp)

	})
})

describe("first()", () => {

	it.only("returns the settled value of the first job that settles. The others are cancelled", async () => {

		let rec: number | string = 0
		let job1WasCancelled = true

		function* job1() {
			yield sleep(2)
			job1WasCancelled = false
			return "job1"
		}

		function* job2() {
			yield sleep(1)
			return 2
		}

		function* main() {
			rec = yield* first(go(job1), go(job2)).$
			yield sleep(1)
		}

		go(main)
		await sleepProm(2)
		expect(rec).toStrictEqual(2)
		expect(job1WasCancelled).toStrictEqual(true)
	})

	it("settles with correct error with a passed in job fails", async () => {

		function* job1() {
			yield sleep(2)
			return "job1"
		}

		function* job2() {
			yield sleep(2)
			throw Error("pow")
		}

		function* main() {
			const res = yield* allDone(go(job1), go(job2)).cont
			yield sleep(1)
			return res
		}

		const rec = await go(main).promfyCont

		if (isE(rec)) {
			throw Error("test failed")
		}

		expect(rec[0]).toBe("job1")

		const otherVal = rec[1]
		const exp = {
			_op: "job2",
			cause: {
				name: "Error",
				message: "pow",
			}
		}
		assertRibuErr(otherVal)
		checkErrSpec(otherVal, exp)

	})
})
