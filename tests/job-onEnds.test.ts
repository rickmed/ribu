import { describe, it, expect } from "vitest"
import { go, sleep, onEnd } from "../source/index.ts"
import { sleepProm } from "./utils.ts"


describe("onEnds run when job's generator function returns", () => {

	it("works with sync fn, async fn and job. Are executed in reverse added order", async () => {

		let onEnds: string[] = []

		function* main() {

			onEnd(() => {
				onEnds.push("sync cleanup")
			})

			onEnd(async () => {
				onEnds.push("async cleanup")
				await sleepProm(1)
			})

			onEnd(function* () {
				onEnds.push("job cleanup")
				yield sleep(1)
			})

			onEnd(() => go(function* () {
				onEnds.push("job2 cleanup")
				yield sleep(1)
			}))

			yield sleep(1)
		}

		await go(main)
		expect(onEnds).toStrictEqual(["job2 cleanup", "job cleanup", "async cleanup", "sync cleanup"])
	})
})