import { expect, it } from "vitest"
import { go, sleep } from "ribu"
import { _Er } from "../source/errors.js"

function* failJob() {
	yield* sleep(1)
	throw Error("test")
}

it("job resolves promise immediately if already done", async () => {

	// eslint-disable-next-line require-yield
	const job = go(function* job() {
		return "done"
	})

	await job
})

it("promise rejects if job fails", async () => {
	try {
		await go(failJob)
		throw Error("promise should have rejected")
	}
	catch (rec) {
		const exp = _Er("failJob", Error("test"))
		expect(rec).toStrictEqual(exp)
	}
})

it(".promErr resolves with the job's value if it succeeds", async () => {
	const job = go(function* job() {
		yield* sleep(1)
		return "done"
	})
	const rec = await job.promHandle
	expect(rec).toStrictEqual("done")
})

it(".promErr returns Err if job fails", async () => {
	const rec = await go(failJob).promHandle
	const exp = _Er("failJob", Error("test"))
	expect(rec).toStrictEqual(exp)
})
