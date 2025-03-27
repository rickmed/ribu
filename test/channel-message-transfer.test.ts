import {  expect, it } from "vitest"
import { Ch, go } from "ribu"


it("putter arrives first", async () => {

	const ch = Ch<string>()

	go(function* putter() {
		yield* ch.put("hello")
	})

	const receiver = go(function* receiver() {
		const msg = yield* ch.rec
		return msg
	})

	const res = await receiver
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

	const res = await receiver
	expect(res).toBe("hi")
})

it("multiple puts and receives in order", async () => {

	const ch = Ch<number>()
	const msgs = [1, 2, 3] as const

	go(function* putter() {
		yield* ch.put(msgs[0])
		yield* ch.put(msgs[1])
		yield* ch.put(msgs[2])
	})

	const receiver = go(function* receiver() {
		let inMsgs: number[] = []
		for (let i = 0; i < msgs.length; i++) {
			const msg = yield* ch.rec
			inMsgs.push(msg)
		}
		return inMsgs
	})

	const result = await receiver
	expect(result).toStrictEqual(msgs)
})

it("multiple producers to single consumer", async () => {

	const ch = Ch<number>()
	const values = [1, 2, 3]

	for (const val of values) {
		go(function* producer() {
			yield* ch.put(val)
		})
	}

	const receiver = go(function* receiver() {
		let inMsgs: number[] = []
		for (let i = 0; i < values.length; i++) {
			const msg = yield* ch.rec
			inMsgs.push(msg)
		}
		return inMsgs
	})

	const res = await receiver
	expect(res).toStrictEqual(values.slice().sort())
})

it("single producer to multiple consumers", async () => {

	const ch = Ch<number>()
	const messages = [0, 1, 2]

	go(function* producer() {
		for (const msg of messages) {
			yield* ch.put(msg)
		}
	})

	const consumers = messages.map(() =>
		go(function* consumer() {
			return yield* ch.rec
		})
	)

	const results = await Promise.all(consumers)
	expect(results).toEqual([0, 1, 2])
})
