import { describe, it, expect } from "vitest"
import { Ch, go, sleep } from "../source/index.js"

describe("message transfer: unbuffered channels", () => {

	it("putter arrives first", async () => {

		const ch = Ch<string>()

		go(function* putter() {
			yield* ch.put("hello")
		})

		const receiver = go(function* receiver() {
			return yield* ch.rec
		})

		const res = await receiver.promfy
		expect(res).toBe("hello")

	})

	it("receiver arrives first", async () => {

		const ch = Ch<string>()

		const receiver = go(function* receiver() {
			const msg = yield* ch.rec
			return msg
		})

		go(function* main() {
			yield* ch.put("hi")
		})

		const res = await receiver.promfy
		expect(res).toBe("hi")

	})

	it("multiple puts and receives in order", async () => {

		const ch = Ch<string>()
		let outMessages = ["one", "two", "three"]

		go(function* main() {
			yield* ch.put("one")
			yield* ch.put("two")
			yield* ch.put("three")
		})

		const receiver = go(function* receiver() {
			let inMsgs: string[] = []
			for (const _ of range(outMessages.length)) {
				const msg = yield* ch.rec
				inMsgs.push(msg)
			}
			return inMsgs
		})

		const result = await receiver.promfy
		expect(result).toEqual(["one", "two", "three"])

	})

	it("multiple producers to single consumer", async () => {

		const ch = Ch<number>()
		let values = [1, 2, 3]

		for (const val of values) {
			go(function* producer() {
				yield* ch.put(val)
			})

		}

		const receiver = go(function* receiver() {
			let received: number[] = []
			for (let i = 0; i < values.length; i++) {
				received.push(yield* ch.rec)
			}
			return received
		})

		let res = await receiver.promfy
		// Order might vary but should have all values
		expect(res.sort()).toEqual(values.sort())

	})

	it("single producer to multiple consumers", async () => {

		const ch = Ch<number>()
		const count = 3

		go(function* producer() {
			for (let i = 0; i < count; i++) {
				yield* ch.put(i)
			}
		})

		const consumers = Array.from({length: count}, () => 0).map(() =>
			go(function* () {
				return yield* ch.rec
			})
		)

		let results = await Promise.all(consumers.map(c => c.promfy))
		expect(results.sort()).toEqual([0, 1, 2])

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

			await sleep(1)
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


function* range(n: number) {
	for (let i = 0; i < n; i++) {
		yield i
	}
}
