// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep, wait, race } from "../source/index.mjs"
import { promSleep } from "./utils.mjs"

// @todo: change tests to make assertions inside processes when sophi is fixed
// with failing test when no assertions are made.

topic("unbuffered channels", () => {

   it("works when putter arrives first and implicit receive", async () => {

      let rec: number = 1

      go(async function main() {

         const ch1 = ch<number>()

         go(async function child() {
            await sleep(1)
            await ch1.put(2)
            await sleep(1)
            await ch1.put(await ch1 * 2)
         })

         await sleep(2)
         rec = await ch1
         await sleep(1)
         await ch1.put(rec * 2)
         rec = await ch1
      })

      await promSleep(5)
      check(rec).with(8)
   })

   it("works when receiver arrives first and implicit receive", async () => {

      let rec: number = 1

      go(async function main() {

         const _ch = ch<number>()

         go(async function child() {
            await sleep(1)  // I sleep so main gets to _ch.rec first.
            await _ch.put(2)
            await sleep(1)
            const _rec = await _ch
            await _ch.put(2 * _rec)
         })

         rec = await _ch
         await sleep(1)
         await _ch.put(rec * 2)
         rec = await _ch
      })

      await promSleep(6)
      check(rec).with(8)
   })

   it("can receive on a channel explicitly accessing .rec getter", async () => {

      let rec: number = 1

      go(async function main() {

         const ch1 = ch<number>()

         go(async function child() {
            await ch1.put(2)
         })

         rec = await ch1
      })

      await promSleep(1)
      check(rec).with(2)
   })
})


topic("buffered channels", () => {

   it("works when putter arrives first and implicit receive", async () => {

      let rec: number[] = []  // eslint-disable-line prefer-const
      let procsOpsOrder: string[] = []  // eslint-disable-line prefer-const

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

      let mutated = false

      go(async function main() {

         go(async function sleeper() {
            await sleep(2)
            mutated = true
         })

         await sleep(0)
      })

      await promSleep(0)

      check(mutated).with(false)
   })
})


topic.skip("process can wait for children processes", () => {

   it("explicit waiting with wait(...Procs). No return values", async () => {

      let mutated = false

      go(function* main() {

         const child = go(function* sleeper() {
            yield sleep(1)
            mutated = true
         })

         yield wait(child)
      })

      await promSleep(2)

      check(mutated).with(true)
   })


   it("implicit waiting with wait(). No return values", async () => {

      let mutated = false

      go(function* main() {

         go(function* sleeper() {
            yield sleep(1)
            mutated = true
         })

         yield wait()
      })

      await promSleep(2)

      check(mutated).with(true)
   })
})


topic.skip("race()", () => {

   it("when all processes finish succesfully", async () => {

      let won = ""

      go(function* main() {

         function* one() {
            yield sleep(2)
            won = "one"
         }

         function* two() {
            yield sleep(1)
            won = "two"
         }

         yield race(go(one), go(two))
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