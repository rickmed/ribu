import { describe, it, expect } from "vitest"



describe.skip("unbuffered channels", () => {

	it("putter arrives first", () => {

		go(function* main() {
			const ch = Ch<number>()

			go(function* sub() {
				yield* ch.put(13)
			})

			const rec = yield* ch.rec
			check_Eq(rec).with(13)
		})
	})

	it("receiver arrives first", async () => {

		go(function* main() {
			const ch = Ch<number>()

			go(function* sub() {
				yield* wait(1)
				yield* ch.put(13)
			})

			const rec = yield* ch.rec
			check_Eq(rec).with(13)
		})
	})

	it.todo("ping pong", async () => {
		// ...
	})
})


describe.skip("buffered channels", () => {

	it("works when receiver arrives first", async () => {

		let recS: Array<number> = []

		go(async function main() {

			const ch1 = Ch<number>(1)

			go(async function child() {
				for (const i of range(2)) {
					await ch1.put(i)
				}
				ch1.close()
			})

			while (ch1.notDone) {
				const rec = await ch1.rec
				recS.push(rec)
			}
		})

		await promSleep(1)
		check_Eq(recS).with([0, 1])
	})

	it("works when putter arrives first", async () => {

		let recS: Array<number> = []

		go(async function main() {

			const ch1 = Ch<number>(1)

			go(async function child() {
				for (const i of range(2)) {
					await ch1.put(i)
				}
				ch1.close()
			})

			await wait(1)
			while (ch1.notDone) {
				const rec = await ch1.rec
				recS.push(rec)
			}
		})

		await promSleep(2)
		check_Eq(recS).with([0, 1])
	})

	it("blocks when buffer is full", async () => {

		let opS: Array<number> = []
		const ch1 = Ch(2)

		go(async function main() {
			for (let i = 0; i < 3; i++) {
				await ch1.put()
				opS.push(i)
			}
		})

		await promSleep(2)
		check_Eq(opS).with([0, 1])
	})
})
