import { describe, expect, it } from "vitest"
import { go } from "../source/job.js"
import { sleep } from "../source/timers.js"
import { assertRibuErr } from "./utils.js"

describe("job can be converted to promise", () => {

	it("resolves correct awaited value when job is successful", async () => {
		const job = go(function* other() {
			yield sleep(1)
			return "ok"
		})

		const res = await job.promfy
		expect(res).toBe("ok")
	})

	it("rejects with correct error when job failed", async () => {

		const exp = {
			name: "Err",
			_op: "main",
			message: "",
			cause: {
				name: "Error",
				message: "boom",
			}
		}

		function* main() {
			yield sleep(1)
			throw Error("boom")
		}

		const rec = await go(main).promfyCont

		assertRibuErr(rec)
		expect(rec).toMatchObject(exp)
	})
})
