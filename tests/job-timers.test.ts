import { describe, expect, it } from "vitest"
import { go, sleep } from "../source/index.ts"
import { sleepProm } from "./utils.ts"


describe("sleep()", () => {

	it("job can sleep() without blocking", async () => {

		let jobDone = false

		go(function* main() {
			yield* sleep(1)
			jobDone = true
		})

		expect(jobDone).toBe(false)
		await sleepProm(2)
		expect(jobDone).toBe(true)
	})
})
