import { describe, expect, it } from "vitest"
import { go, sleep } from "../source/index.js"
import { all, allOrFail, first, firstOK, fromProm } from "../source/job-helpers.js"
import { assertRibuErr, checkErrSpec, sleepProm } from "./utils.js"
import { isE } from "../source/errors.js"


//* ********** Job Combinators  ********** *//

describe("allDone()", () => {

	it("waits for jobs concurrently and return their results in an array", async () => {

		let res: Array<string| number> = []

		function* job1() {
			yield sleep(10)
			return "job1"
		}

		function* job2() {
			yield sleep(10)
			return 2
		}

		function* main() {
			res = yield* all(go(job1), go(job2)).$
			yield sleep(0)
		}

		go(main)
		// sleepProm() ensures that job1 and job2 are ran concurrently
		await sleepProm(15)
		expect(res).toStrictEqual(["job1", 2])
	})
})

describe("allOrFail()", () => {

	it("waits for jobs concurrently and return their results in an array", async () => {

		let res: Array<string| number> = []

		function* job1() {
			yield sleep(10)
			return "job1"
		}

		function* job2() {
			yield sleep(10)
			return 2
		}

		function* main() {
			res = yield* allOrFail(go(job1), go(job2)).$
			yield sleep(0)
		}

		go(main)
		// sleepProm(15) ensures that job1 and job2 are ran concurrently
		await sleepProm(15)
		expect(res).toStrictEqual(["job1", 2])
	})

	it("settles with correct error if a passed-in job fails (others are cancelled)", async () => {

		const exp = {
			name: "ProgramFailed",
			_op: "main",
			cause: {
				name: "AJobFailed",
				_op: "allOrFail",
				cause: {
					_op: "job2",
					cause: {
						name: "Error",
						message: "pow",
					}
				}
			},
		}

		let job1WasCancelled = true

		function* job1() {
			yield sleep(4)
			job1WasCancelled = false
			return "job1"
		}

		function* job2() {
			yield sleep(2)
			throw Error("pow")
		}

		function* main() {
			const res = yield* allOrFail(go(job1), go(job2)).cont
			yield sleep(1)
			if (isE(res)) {
				return res.E("ProgramFailed")
			}
			return res
		}

		const rec = await go(main).promfyCont

		assertRibuErr(rec)
		checkErrSpec(rec, exp)
		expect(job1WasCancelled).toBe(true)
	})
})

describe("first()", () => {

	it("returns the settled value of the first job that settles. The others are cancelled", async () => {

		let rec: number | string = 0
		let job1WasCancelled = true

		function* job1() {
			yield sleep(20)
			job1WasCancelled = false
			return "job1"
		}

		function* job2Faster() {
			yield sleep(10)
			return 2
		}

		function* main() {
			rec = yield* first(go(job1), go(job2Faster)).$
			yield sleep(1)
		}

		go(main)
		await sleepProm(15)
		expect(rec).toStrictEqual(2)
		expect(job1WasCancelled).toStrictEqual(true)
	})
})

describe("firstOK()", () => {

	it("returns the settled value of the first job that settles _succesfully_. The others are cancelled. The jobs that failed are ignored", async () => {

		let rec: number | string = 0
		let job1WasCancelled = true

		function* job1Slow() {
			yield sleep(20)
			job1WasCancelled = false
			return "job 1"
		}

		function* job2Fails() {
			yield sleep(5)
			throw Error("")
			return "irrelevant"
		}

		function* job3Good() {
			yield sleep(10)
			return 3
		}

		function* main() {
			rec = yield* firstOK(go(job1Slow), go(job2Fails), go(job3Good)).$
			yield sleep(1)
		}

		go(main)
		await sleepProm(15)

		expect(rec).toStrictEqual(3)
		expect(job1WasCancelled).toStrictEqual(true)
	})

	it("settles with correct error if all jobs failed", async () => {

		function* job1Fails() {
			yield sleep(5)
			throw Error("")
			return "irrelevant"
		}

		function* job2Fails() {
			yield sleep(5)
			throw Error("")
			return "irrelevant"
		}

		function* main() {
			yield* firstOK(go(job1Fails), go(job2Fails)).$
			yield sleep(1)
		}

		const rec = await go(main).promfyCont

		const exp = {
			_op: "main",
			cause: {
				name: "AllJobsFailed",
				_op: "firstOK"
			}
		}
		assertRibuErr(rec)
		checkErrSpec(rec, exp)

	})
})


//* **********  Promise to Job  ********** *//

describe("yield* fromProm()", () => {

	it("job gets resumed when promise resolves", async () => {

		function* main() {
			const job = fromProm(Promise.resolve(1))
			const res = yield* job.$
			return res
		}

		const rec = await go(main).promfyCont
		expect(rec).toBe(1)
	})


	it("job fails with correct error when promise rejects", async () => {

		function* main() {
			const job = fromProm(Promise.reject("Bad"))
			const res = yield* job.$
			return res
		}

		const rec = await go(main).promfyCont

		const exp = {
			_op: "main",
			cause: {
				name: "PromiseRejected",
				_op: "fromProm",
				cause: "Bad",
			}
		}
		assertRibuErr(rec)
		checkErrSpec(rec, exp)
	})
})
