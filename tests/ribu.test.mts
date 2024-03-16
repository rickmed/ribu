// @ts-ignore @todo
import { topic, it, check, check_ThrowsAsync, lossy, strict, satisfies } from "sophi"
import { go, Ch, sleep } from "../source/index.mjs"
import { promSleep, eqType, range } from "./utils.mjs"
import { E, ECancOK, Err, isE } from "../source/errors.mjs"


topic("Types", () => {

   function* checkTypes() {  // eslint-disable-line @typescript-eslint/no-unused-vars

      const job = go(function* fn(x?: number) {
         yield sleep(1)
         if (!x) return E("NoNumber")
         if (x < 5) return E("TooLow")
         if (x < 10) return "ok"
         return 1
      })

      const x1 = yield* job.$
      eqType<"ok" | 1>(x1)

      const x2 = yield* job.cont
      eqType<"ok" | 1 | E<"NoNumber"> | E<"TooLow"> | ECancOK | Err>(x2)

      const x3 = yield* job.cancel()
      eqType<undefined>(x3)

      const x4 = yield* job.cancelHandle()
      eqType<Err | undefined>(x4)
   }
})


topic("job timers", () => {

   it("can sleep() without blocking", async () => {

      let x = false

      go(function* sleeper() {
         yield sleep(1)
         x = true
      })

      check(x, false)
      await promSleep(2)
      check(x, true)
   })
})


topic("jobs can wait for other jobs to finish", () => {

   it("using .$", async () => {

      let done: boolean = false

      go(function* main() {
         done = yield* go(function* sleeper() {
            yield sleep(1)
            return true
         }).$
      })

      await promSleep(2)
      check(done).with(true)
   })

   it("using .cont", async () => {

      let done: boolean = false

      go(function* main() {

         const res = yield* go(function* sleeper() {
            yield sleep(1)
            return true
         }).cont

         if (res instanceof Error) return res
         else return done = res
      })

      await promSleep(2)
      check(done).with(true)
   })

   it("parent auto waits for running children to finish", async () => {

      let done = 0
      let testSuccess = false

      go(function* main() {

         yield* go(function* parent() {  // eslint-disable-line require-yield
            go(function* child1() {
               yield sleep(1)
               done++
            })
            go(function* child1() {
               yield sleep(1)
               done++
            })
         }).$

         if (done === 2) testSuccess = true
      })

      await promSleep(2)
      check(testSuccess).with(true)
   })
})

// if job "fails" (ie, settles with ::Error) promise rejects (await throws)

topic("job is thenable", () => {

   it("returns correct awaited value when job is successful", async () => {
      const job = go(function* other() {
         yield sleep(1)
         return "ok"
      })

      const res = await job
      check(res).with("ok")
   })

   it("rejects on await when job failed", async () => {

      async function test() {
         const job = go(function* other() {
            yield sleep(1)
            throw Error("kapow")
         })

         await job
      }

      await check_ThrowsAsync(test)
   })
})


topic("job cancellation", () => {

   it("job can cancel other job with", async () => {

      let mutated = false

      go(function* main() {

         const job = go(function* other() {
            yield sleep(3)
            mutated = true
         })

         yield sleep(1)
         yield* job.cancel()
      })

      await promSleep(5)
      check(mutated).with(false)
   })
})


topic("job errors", () => {

   it("throws the right error when waiting using .$", async () => {

		// todo: change to use sophi.check_throwsJob when ready
		const rec = await check_ThrowsAwait(async () => {
			const job = go(function* main() {
				yield* go(function* inner() {
					yield sleep(1)
					throw Error("bad")
				}).$
			})

			await job
		})

		const nativeErr = rec.cause?.cause as Error
		delete rec.cause?.cause

		check(nativeErr.stack).satisfies(function hasCorrectStrings(s: string) {
			return s.includes(`Error: bad`) && s.includes(`at inner`)
		})

		const exp = {
			name: "Err",
			_op: "main",
			message: "",
			cause: {
				name: "Err",
				_op: "inner",
				message: "",
			}
		}

		check(rec).with(exp)
   })

   // it.only("mock test delete this", async () => {

   //    const rec = {
   //       name: "Err",
   //       _op: "main",
   //       message: "hola",
   //       cause: {
   //          name: "Err",
   //          _op: "inner",
   //          message: "",
   //       }
   //    }

   //    function isGood(a: unknown, v: string) {
   //       return [v === "hola", ``]
   //    }

   //    const exp = {
   //       name: "Err",
   //       _op: "main",
   //       message: satisfies(isGood, {}),
   //       cause: {
   //          name: "Err",
   //          _op: "inner",
   //          message: "",
   //       }
   //    }

   //    check(rec).with(exp)
   // })

})


topic.skip("unbuffered channels", () => {

   it("putter arrives first", () => {

      go(function* main() {
         const ch = Ch<number>()

         go(function* sub() {
            yield* ch.put(13)
         })

         const rec = yield* ch.rec
         check(rec).with(13)
      })
   })

   it("receiver arrives first", async () => {

      go(function* main() {
         const ch = Ch<number>()

         go(function* sub() {
            yield* wait(1)
            yield* ch.put(13)
         })

         const rec = yield* ch.rec
         check(rec).with(13)
      })
   })

   it.todo("ping pong", async () => {
      // ...
   })
})


topic.skip("race()", () => {

   it("when all processes finish succesfully", async () => {

      let won = ""

      go(async () => {

         async function one() {
            await wait(2)
            won = "one"
         }

         async function two() {
            await wait(1)
            won = "two"
         }

         await race(go(one), go(two)).rec
      })

      await promSleep(3)
      check(won).with("two")
   })


   // it("when all processes finish succesfully using the return value", async () => {

   //    let won = ""

   //    go(function* main() {

   //       const one = go(function* one() {
   //          yield sleep(2)
   //          yield this.done.put("one")
   //       })

   //       const two = go(function* two() {
   //          yield sleep(1)
   //          yield this.done.put("two")
   //       })

   //       won = (yield race(one, two))   as string
   //    })

   //    await promSleep(3)

   //    check(won).with("two")
   // })
})

topic.skip("buffered channels", () => {

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
      check(recS).with([0, 1])
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

         await wait(1)
         while (ch1.notDone) {
            const rec = await ch1.rec
            recS.push(rec)
         }
      })

      await promSleep(2)
      check(recS).with([0, 1])
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
      check(opS).with([0, 1])
   })
})
