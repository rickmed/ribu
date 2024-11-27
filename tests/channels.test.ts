import { describe, it, expect } from "vitest"
import { Ch, go, sleep } from "../source/index.js"

describe("unbuffered channels", () => {

	it("should transfer a message from putter to receiver when putter arrives first", async () => {
      const result = await new Promise<string>((resolve) => {
        go(function* main() {
          const ch = Ch<string>()

          go(function* putter() {
            yield* ch.put("hello")
          })

          const message = yield* ch.rec
          resolve(message)
        })
      })

      expect(result).toBe("hello")
    })

    it("should transfer a message from putter to receiver when receiver arrives first", async () => {
      const result = await new Promise<string>((resolve) => {
        go(function* main() {
          const ch = Ch<string>()

          go(function* receiver() {
            const message = yield* ch.rec
            resolve(message)
          })

          yield sleep(10)  // ensure receiver starts first
          yield* ch.put("hi")
        })
      })

      expect(result).toBe("hi")
    })

	 it("should handle multiple puts and receives in order", async () => {
      const result = new Promise<string[]>((resolve) => {
			const ch = Ch<string>()

          go(function* putter() {
            yield* ch.put("one")
            yield* ch.put("two")
            yield* ch.put("three")
          })

          go(function* receiver() {
				let msgs: string[] = []

            for (let i = 0; i < 3; i++) {
              const message = yield* ch.rec
              msgs.push(message)
            }
            resolve(msgs)
          })
      })

      expect(await result).toEqual(["one", "two", "three"])
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
