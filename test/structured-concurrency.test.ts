import { expect, it } from "vitest"
import { Err, go, me, sleep } from "ribu"
import { _Err } from "../source/errors.js"

/*
	This suite is focused on what happens when a job returns and still
	has children running (blocked at some operation).
*/

it("parent waits until its children settle", async () => {

	let jobsDone = 0

	function* child1() {
		yield* sleep(3)
		jobsDone++
	}

	function* child2() {
		yield* sleep(3)
		jobsDone++
	}

	function* main() {
		go(child1)
		go(child2)
		yield* sleep(1)
	}

	await go(main)
	expect(jobsDone).toBe(2)
})

it("if parent fails, it cancels its children", async () => {

	let finished = 0

	function* child1() {
		yield* sleep(3)
		finished++
	}

	function* child2() {
		yield* sleep(4)
		finished++
	}

	function* main() {
		go(child1)
		go(child2)
		yield* sleep(1)
		throw Error("Bad")
	}

	const rec = await go(main).promErr
	const exp = _Err("main", Error("Bad"))
	expect(rec).toStrictEqual(exp)
	expect(finished).toBe(0)
})

it("if child fails, parent waits for its other children to settle " +
	"and fails with correct Error", async () => {

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
	const exp = _Err("main", _Err("child1", Error("Bad")))
	expect(rec).toStrictEqual(exp)
	expect(child2Finished).toBe(true)
})

it("if child fails and parent is set up at cancelSiblingsOnErr(), parent" +
	"cancels its other children and settles with correct Error", async () => {

	let childrenFinished = 0

	function* child1() {
		yield* sleep(2)
		return Err("Bad")
	}

	function* child2() {
		yield* sleep(3)
		childrenFinished++
	}

	function* child3() {
		yield* sleep(3)
		childrenFinished++
	}

	function* main() {
		me().cancelSiblingsOnErr()
		yield* sleep(1)
		go(child1)
		go(child2)
		go(child3)
	}

	const rec = await go(main).promErr
	const exp =
		_Err("main",
			_Err("child1",
				Err("Bad")
			)
		)
	expect(rec).toStrictEqual(exp)
	expect(childrenFinished).toBe(0)
})
