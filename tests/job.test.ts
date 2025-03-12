import { describe, it, expect } from "vitest"
import { go, sleep } from "../source/index.ts"


describe(`Jobs block and resume each other with their return values`, () => {

	it("yield*", async () => {

		function* child() {
			yield sleep(1)
			return "child one"
		}

		function* main() {
			const res = yield* go(child)
			return res
		}

		const rec = await go(main).pErr
		expect(rec).toBe("child one")
	})

	it("yield* job.err", async () => {

		function* child() {
			yield sleep(1)
			return "child done"
		}

		function* main() {
			const res = yield* go(child).err
			return res
		}

		const rec = await go(main).pErr
		expect(rec).toBe("child done")
	})
})
