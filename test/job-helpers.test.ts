import { describe, expect, it } from "vitest"
import { go, sleep, allOrErr, Err, onEnd } from "ribu"
import { EMPTY_ARGS } from "../source/job-helpers.js"
import { _Err } from "../source/errors.js"

describe("allOrErr()", () => {

	function* badJob() {
		yield* sleep(3)
		return Err("Bad")
	}

	it("all jobs succeed", async () => {

		function* job1() {
			yield* sleep(2)
			return "one"
		}

		function* job2() {
			yield* sleep(3)
			return 2
		}

		function* main() {
			const jobs = [go(job1), go(job2)]
			const res = yield* allOrErr(jobs)
			return res
		}

		const rec = await go(main)
		expect(rec.toSorted()).toStrictEqual([2, "one"].toSorted())
	})

	it(`fails with ${EMPTY_ARGS} if arguments empty`, async () => {

		function* main() {
			yield* allOrErr([])
		}

		const rec = await go(main).promHandle

		const exp =
			_Err("main",
				Err(EMPTY_ARGS, "allOrErr")
			)

		expect(rec).toStrictEqual(exp)
	})

	it("settles with correct error if a passed-in job fails. The other" +
		"passed-in jobs are cancelled", async () => {

		let ctx = { count: 0 }

		function* jobFailsCancelling(ctx: {count: number}) {
			onEnd(() => Err("BadCancelling"))
			yield* sleep(5)
			ctx.count++
		}

		function* main() {
			const jobs = [go(jobFailsCancelling, ctx), go(badJob)]
			const res = yield* allOrErr(jobs).handle
			return { res }
		}

		const rec = await go(main)

		const exp =
			Err("JobHadErr", "allOrErr", undefined, [
				Err("Bad", "badJob"),
				_Err("jobFailsCancelling", Err("BadCancelling"), "Cancelled")
			])
		expect(rec.res).toStrictEqual(exp)
		expect(ctx.count).toBe(0)
	})
})






// describe.skip("allDone()", () => {

// 	it("waits for jobs concurrently and return their results in an array", async () => {

// 		let res: Array<string| number> = []

// 		function* job1() {
// 			yield* sleep(10)
// 			return "job1"
// 		}

// 		function* job2() {
// 			yield* sleep(10)
// 			return 2
// 		}

// 		function* main() {
// 			res = yield* all(go(job1), go(job2))
// 			yield* sleep(0)
// 		}

// 		go(main)
// 		// sleepProm() ensures that job1 and job2 are ran concurrently
// 		await sleepProm(15)
// 		expect(res).toStrictEqual(["job1", 2])
// 	})
// })



// describe.skip("first()", () => {

// 	it("returns the settled value of the first job that settles. The others are cancelled", async () => {

// 		let rec: number | string = 0
// 		let job1WasCancelled = true

// 		function* job1() {
// 			yield* sleep(20)
// 			job1WasCancelled = false
// 			return "job1"
// 		}

// 		function* job2Faster() {
// 			yield* sleep(10)
// 			return 2
// 		}

// 		function* main() {
// 			rec = yield* first(go(job1), go(job2Faster)).$
// 			yield* sleep(1)
// 		}

// 		go(main)
// 		await sleepProm(15)
// 		expect(rec).toBe(2)
// 		expect(job1WasCancelled).toBe(true)
// 	})
// })

// describe.skip("firstOK()", () => {

// 	it("returns the settled value of the first job that settles _succesfully_. The others are cancelled. The jobs that failed are ignored", async () => {

// 		let rec: number | string = 0
// 		let job1WasCancelled = true

// 		function* job1Slow() {
// 			yield* sleep(20)
// 			job1WasCancelled = false
// 			return "job 1"
// 		}

// 		function* job2Fails() {
// 			yield* sleep(5)
// 			throw Error("")
// 			return "irrelevant"
// 		}

// 		function* job3Good() {
// 			yield* sleep(10)
// 			return 3
// 		}

// 		function* main() {
// 			rec = yield* firstOK(go(job1Slow), go(job2Fails), go(job3Good)).$
// 			yield* sleep(1)
// 		}

// 		go(main)
// 		await sleepProm(15)

// 		expect(rec).toBe(3)
// 		expect(job1WasCancelled).toBe(true)
// 	})

// 	it("settles with correct error if all jobs failed", async () => {

// 		function* job1Fails() {
// 			yield* sleep(5)
// 			throw Error("")
// 			return "irrelevant"
// 		}

// 		function* job2Fails() {
// 			yield* sleep(5)
// 			throw Error("")
// 			return "irrelevant"
// 		}

// 		function* main() {
// 			yield* firstOK(go(job1Fails), go(job2Fails)).$
// 			yield* sleep(1)
// 		}

// 		const rec = await go(main).promfyCont

// 		const exp = {
// 			_op: "main",
// 			cause: {
// 				name: "AllJobsFailed",
// 				_op: "firstOK"
// 			}
// 		}
// 		assertRibuErr(rec)
// 		expect(rec).toMatchObject(exp)
// 		expect(rec.cause).toBeInstanceOf(Err)

// 	})
// })


// //* **********  Promise to Job  ********** *//

// describe.skip("yield* fromProm()", () => {

// 	it("job gets resumed when promise resolves", async () => {

// 		function* main() {
// 			const job = promToJob(Promise.resolve(1))
// 			const res = yield* job.$
// 			return res
// 		}

// 		const rec = await go(main).promfyCont
// 		expect(rec).toBe(1)
// 	})


// 	it("job fails with correct error when promise rejects", async () => {

// 		function* main() {
// 			const job = promToJob(Promise.reject("Bad"))
// 			const res = yield* job.$
// 			return res
// 		}

// 		const rec = await go(main).promfyCont

// 		const exp = {
// 			_op: "main",
// 			cause: {
// 				name: "PromiseRejected",
// 				_op: "fromProm",
// 				cause: "Bad",
// 			}
// 		}
// 		assertRibuErr(rec)
// 		expect(rec).toMatchObject(exp)
// 		expect(rec.cause).toBeInstanceOf(Err)
// 	})
// })
