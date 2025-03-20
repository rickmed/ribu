import { it } from "vitest"
import { go } from "../source/job.js"

it("job resolves promise immediately if already done", async () => {

	await go(function* job() {})
})