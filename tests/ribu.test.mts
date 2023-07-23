// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep, wait, race } from "../source/index.mjs"
import { promSleep } from "./utils.mjs"
import csp from "../source/initCsp.mjs"

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
            console.log("child 1:", csp.runningPrc?._fnName)
            await ch1.put(2)
            console.log("child 2:", csp.runningPrc?._fnName)
         })

         await sleep(2)
         rec = await ch1
         console.log("main 1:", csp.runningPrc?._fnName)

      })

      await promSleep(10)
      check(rec).with(2)
   })

   it.skip("works when putter arrives first", async () => {

      let rec: number = 1

      go(async function main() {

         const ch1 = ch<number>()

         go(async function child() {
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

      await promSleep(3)
      console.log("TEST 1: done", {rec})
      check(rec).with(8)
   })

   it("works when receiver arrives first", async () => {
      console.log("TEST 2: start")

      let recS: string = ""

      go(async function main1() {

         const _ch = ch<string>()

         go(async function child1() {
            // console.log("child 1", csp.runningPrc?._fnName)
            await sleep(1)  // I sleep so main gets to _ch.rec first.
            await _ch.put("child ")
            // console.log("child 2", csp.runningPrc?._fnName)
            await sleep(2)
            const _rec = await _ch.rec
            await _ch.put(_rec + _rec)
            console.log("CHILD1: done")
         })

         recS = await _ch.rec
         // console.log("main 1", csp.runningPrc?._fnName)
         await sleep(1)
         // console.log("main 2", csp.runningPrc?._fnName)
         await _ch.put("main " + recS)
         recS = await _ch.rec
         console.log("MAIN1: done")
      })

      await promSleep(6)
      console.log("TEST 2: done")
      check(recS).with("main child main child ")
   })
})


topic.skip("buffered channels", () => {

   it("works when putter arrives first", async () => {

      let rec: Array<number> = []  // eslint-disable-line prefer-const
      let procsOpsOrder: Array<string> = []  // eslint-disable-line prefer-const

      go(async function main() {

         const ch1 = ch<number>(2)

         go(async function child() {
            await ch1.put(1)
            procsOpsOrder.push("child")
            await ch1.put(1)
            procsOpsOrder.push("child")
            await ch1.put(1)  // blocked here
            procsOpsOrder.push("child")
         })

         rec.push(await ch1)
         procsOpsOrder.push("main")
         await sleep(1)
         rec.push(await ch1)
         procsOpsOrder.push("main")
         rec.push(await ch1)
         procsOpsOrder.push("main")
      })

      await promSleep(5)
      check(rec).with([1, 1, 1])
      check(procsOpsOrder).with(["child", "child", "main", "child", "main", "main"])
   })
})


topic("process cancellation", () => {

   it("ribu automatically cancels child if parent does not wait to be done", async () => {
      console.log("TEST 3: start")

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

         await wait(child)
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

         await wait()
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

         await race(go(one), go(two))
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