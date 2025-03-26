import { describe, expect, it } from "vitest"
import { Ch, go } from "ribu"


it.skip("putter arrives first", async () => {

	const ch = Ch<string>()

	go(function* putter() {
		yield* ch.put("hello")
	})

	const receiver = go(function* receiver() {
		const msg = yield* ch.rec
		return msg
	})

	const res = await receiver.promfy
	expect(res).toBe("hello")
})

it.skip("receiver arrives first", async () => {

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

it.skip("multiple puts and receives in order", async () => {

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

it.skip("multiple producers to single consumer", async () => {

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

	const res = await receiver.promfy
	expect(res).toEqual(values.sort())
})

it.skip("single producer to multiple consumers", async () => {

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

	const results = await Promise.all(consumers.map(c => c.promfy))
	expect(results).toEqual([0, 1, 2])
})


function* range(n: number) {
	for (let i = 0; i < n; i++) {
		yield i
	}
}

/*
	put:
		1) sets whoever job yield* first to park/resume via the iterator result
		2) Enqueues job/thing (or continues)

	ch.put(1)
	ch.put(1)
	yield* sleep(1000)

	BAD: would put runningJob in the queue twice and resume at sleep (if receiver resumes me, before sleep)
	BAD: should not be possible to put me in the queue twice (Channel aren't buffered)
		,ie, a receiver will try to resume me if blocked doing waiting for something else


	todo: test that ch.put() or .rec without yield* does nothing.
*/

// todo: test .rec and put returns correct types
