import { describe, it, expect } from "vitest"
import { go, sleep } from "ribu"


describe(`Jobs block and resume each other with their return values`, () => {

	function* child(doneVal?: string) {
		yield* sleep(1)
		return doneVal
	}

	const doneVal = "done"

	it("yield* job", async () => {

		function* main(doneVal?: string) {
			return yield* go(child, doneVal)
		}

		const rec = await go(main, doneVal)
		expect(rec).toBe(doneVal)
	})

	it("yield* job.err", async () => {

		function* main(doneVal?: string) {
			return yield* go(child, doneVal).err
		}

		const rec = await go(main, doneVal)
		expect(rec).toBe(doneVal)
	})
})


// function* sup() {

// 	for()




// }