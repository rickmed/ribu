import { expect, it } from "vitest"
import { go, me, sleep } from "ribu"
import { _Err } from "./utils.js"
import { GenFnErr, WaitingChldErr } from "../source/errors.js"


it("if job returns and it has active children, it is blocked until its children are done", async () => {

	let jobsDone = 0

	function* child() {
		yield* sleep(2)
		jobsDone++
	}

	function* child2() {
		yield* sleep(2)
		jobsDone++
	}

	function* main() {
		go(child)
		go(child2)
		yield* sleep(1)
	}

	await go(main)
	expect(jobsDone).toBe(2)
})


it("if parent job fails, it cancels its children", async () => {

	let finished = 0

	function* child1() {
		yield* sleep(2)
		finished++
	}

	function* child2() {
		yield* sleep(3)
		finished++
	}

	function* main() {
		go(child1)
		go(child2)
		yield* sleep(1)
		throw Error("Bad")
	}

	const rec = await go(main).promErr
	const exp = GenFnErr("main", Error("Bad"))
	expect(rec).toStrictEqual(exp)
	expect(finished).toBe(0)
})

it("if child job fails and parent is set up at cancelSiblingsOnErr(), " +
	"parent cancels its other children and is resolved with correct Error", async () => {

	let child2Finished = false

	function* child1() {
		yield* sleep(2)
		throw Error("Bad")
	}

	function* child2() {
		yield* sleep(3)
		child2Finished = true
	}

	function* main() {
		me().cancelSiblingsOnErr()
		yield* sleep(1)
		go(child1)
		go(child2)
	}

	const rec = await go(main).promErr
	const exp = WaitingChldErr("main", GenFnErr("child1", Error("Bad")))
	expect(rec).toStrictEqual(exp)
	expect(child2Finished).toBe(false)
})

it("if child job fails, parent fails with correct Error, " +
	"and waits for other children to finish normally", async () => {

	let child2Finished = false

	function* child1() {
		yield* sleep(2)
		throw Error("Bad")
	}

	function* child2() {
		yield* sleep(3)
		child2Finished = true
	}

	function* main() {
		yield* sleep(1)
		go(child1)
		go(child2)
	}

	const rec = await go(main).promErr
	const exp = WaitingChldErr("main", GenFnErr("child1", Error("Bad")))
	expect(rec).toStrictEqual(exp)
	expect(child2Finished).toBe(true)
})
