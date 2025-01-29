import { describe, it, expect } from "vitest"
import { Ch, go, sleep } from "../source/index.js"

describe("channel closing with pending operations", () => {

	it.only("should handle closing with pending put", async () => {
		const job = go(function* main() {
			const ch = Ch<string>()
			let results: string[] = []

			// Start a put that will be pending since no receiver
			go(function* producer() {
				try {
					yield* ch.put("message")
					results.push("put completed: should not reach here")
				} catch {
					results.push("put interrupted")
				}
			})

			yield sleep(10) // Let put operation start and block
			ch._done()

			return results
		})

		const res = await job.promfy
		expect(res).toEqual(["put interrupted"])
	})

	it("should handle closing with pending receive", async () => {
		const job = go(function* main() {
			const ch = Ch<string>()
			let results: string[] = []

			// Start a receive that will be pending since no sender
			go(function* receiver() {
				try {
					const msg = yield* ch.rec
					results.push(`received: ${msg}`) // Should not reach here
				} catch (err) {
					results.push("receive interrupted") // Should get here
				}
			})

			yield sleep(10) // Let receive operation start and block
			ch._done()

			return results
		})

		const res = await job.promfy
		expect(res).toEqual(["receive interrupted"])
	})
})
