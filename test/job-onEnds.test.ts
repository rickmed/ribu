import { it, expect } from "vitest"
import { go, sleep, onEnd, Err } from "ribu"
import { sleepProm } from "./utils.js"
import { _Err } from "../source/errors.js"

it("can run sync functions, async functions and job generator functions." +
	"Are executed sequentially and in reverse order of registration", async () => {

	let onEnds: string[] = []

	function* main() {

		onEnd(() => {
			onEnds.push("sync")
		})

		onEnd(async () => {
			onEnds.push("async")
			const sleepMs = random(0, 10)
			await sleepProm(sleepMs)
		})

		onEnd(function* () {
			onEnds.push("job")
			const sleepMs = random(0, 10)
			yield* sleep(sleepMs)
		})

		yield* sleep(1)
	}

	await go(main)
	expect(onEnds).toStrictEqual(["job", "async", "sync"])
})

it("job fails with correct Err if onEnd fails", async () => {

	function* main() {

		onEnd(function badSync() {
			return Err("BadSync")
		})

		yield* sleep(1)
	}

	const rec = await go(main).promHandle
	const exp = _Err("main", undefined, Err("BadSync", "badSync"))
	expect(rec).toStrictEqual(exp)
})

it("job executes all onEnds even if some of them fail. " +
	"Settles with correct Err", async () => {

	let finished: string[] = []

	function* main() {

		onEnd(function badSync() {
			return Err("BadSync")
		})

		onEnd(() => {
			finished.push("sync")
		})

		onEnd(function* badJob() {
			yield* sleep(1)
			return Err("BadJob")
		})

		onEnd(function* goodJob() {
			yield* sleep(1)
			finished.push("job")
		})

		onEnd(async function badAsync() {
			await sleepProm(1)
			throw Error("BadAsync")
		})

		onEnd(async () => {
			await sleepProm(1)
			finished.push("async")
		})

		yield* sleep(1)
	}

	const rec = await go(main).promHandle
	const exp = _Err("main", undefined,
		[
			_Err("badAsync", Error("BadAsync")),
			Err("BadJob", "badJob"),
			Err("BadSync", "badSync")
		]
	)
	expect(rec).toStrictEqual(exp)
	expect(finished).toStrictEqual(["async", "job", "sync"])
})


function random(min: number, max: number) {
	return Math.floor(Math.random() * (max - min) + min)
}