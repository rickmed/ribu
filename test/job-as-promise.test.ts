import { expect, it } from "vitest"
import { go } from "../source/job.js"
import { sleep } from "../source/index.js"
import { _Err } from "../source/errors.js"

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
		const exp = _Err("failJob", Error("test"))
		expect(rec).toStrictEqual(exp)
	}
})

it(".promErr returns Err if job fails", async () => {
	const rec = await go(failJob).promErr
	const exp = _Err("failJob", Error("test"))
	expect(rec).toStrictEqual(exp)
})
