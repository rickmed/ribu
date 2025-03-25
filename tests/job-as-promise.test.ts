import { it } from "vitest"
import { go } from "../source/job.js"

it("job resolves promise immediately if already done", async () => {

	await go(function* job() {})
})

it.todo("promise rejects if job fails")


async function checkAsyncFnThrows(fn: () => Promise<unknown>) {
	try {
		await fn()
		throw Error("function should have thrown")
	}
	catch (e) {
		return e
	}
}