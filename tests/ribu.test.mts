// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep, wait, race } from "../source/index.mjs"
import { promSleep, range } from "./utils.mjs"
// import csp from "../source/initCsp.mjs"

// @todo: change tests to make assertions inside processes when sophi is fixed
// with failing test when no assertions are made.

topic("unbuffered channels", () => {

   it.skip("native proms experiment", async () => {

      let rec: number = 1

      go(async function main() {

         const ch1 = ch<number>()

         go(async function child() {

            await promSleep(1)

            // here sleep(3) thinks csp is main bc is what go(main) sets
            // when returns. And then promSleep(1) does not update it

            /*
               Maybe I can exploit the fact that a process can be blocked
               at only one operation.

               So if I see that runningPrc is already blocked, I throw.

            */
            await sleep(3)
            await ch1.put(2)
         })

         await sleep(2)
         rec = await ch1.rec
      })

      await promSleep(10)
      check(rec).with(2)
   })

   it("works when putter arrives first", async () => {

      let rec: number = 1

      go(async function main1() {

         const ch1 = ch<number>()

         go(async function child1() {
            await sleep(1)
            await ch1.put(2)
            await sleep(1)
            const _rec = await ch1.rec
            await ch1.put(_rec * 2)
         })

         await sleep(2)
         rec = await ch1.rec
         await sleep(1)
         await ch1.put(rec * 2)
         rec = await ch1.rec
      })

      await promSleep(8)
      check(rec).with(8)
   })

   it("works when receiver arrives first", async () => {

      let recS: string = ""

      go(async function main2() {

         const _ch = ch<string>()

         go(async function child2() {
            await sleep(1)  // I sleep so main gets to _ch.rec first.
            await _ch.put("child ")
            await sleep(2)
            const _rec = await _ch.rec
            await _ch.put(_rec + _rec)
         })

         recS = await _ch.rec
         await sleep(1)
         await _ch.put("main " + recS)
         recS = await _ch.rec
      })

      await promSleep(8)
      check(recS).with("main child main child ")
   })
})


topic("buffered channels", () => {

   it.only("works when receiver arrives first", async () => {

      let recS: Array<number> = []

      go(async function main() {

         const ch1 = ch<number>(1)

         go(async function child() {
            for (const i of range(2)) {
               await ch1.put(i)
            }
         })

         for (let i = 0; i < 2; i++) {
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

         const ch1 = ch<number>(1)

         go(async function child() {
            for (const i of range(2)) {
               await ch1.put(i)
            }
         })

         await sleep(1)
         for (let i = 0; i < 2; i++) {
            const rec = await ch1.rec
            recS.push(rec)
         }
      })

      await promSleep(1)
      check(recS).with([0, 1])
   })

   it("blocks when buffer is full", async () => {

      let opS: Array<number> = []
      const ch1 = ch(2)

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


topic("process cancellation", () => {

   it("ribu automatically cancels child if parent does not wait to be done", async () => {

      let mutated = false

      go(async function main3() {

         go(async function sleeper() {
            await sleep(3)
            mutated = true
         })

         await sleep(1)
      })

      await promSleep(2)
      check(mutated).with(false)
   })
})


topic.skip("process can wait for children processes", () => {

   it("explicit waiting with wait(...Procs). No return values", async () => {

      let mutated = false

      go(async function main() {

         const child = go(async function sleeper() {
            await sleep(1)
            mutated = true
         })

         await wait(child).rec
      })

      await promSleep(2)

      check(mutated).with(true)
   })


   it("implicit waiting with wait(). No return values", async () => {

      let mutated = false

      go(async function main() {

         go(async function sleeper() {
            await sleep(1)
            mutated = true
         })

         await wait().rec
      })

      await promSleep(2)

      check(mutated).with(true)
   })
})


topic.skip("race()", () => {

   it("when all processes finish succesfully", async () => {

      let won = ""

      go(async () => {

         async function one() {
            await sleep(2)
            won = "one"
         }

         async function two() {
            await sleep(1)
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