import { describe, expect, it } from "vitest"
import { go, sleep } from "ribu"
import { sleepProm } from "./utils.js"


describe("sleep()", () => {

	it("job can sleep() for a specified duration without blocking the main thread", async () => {

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
