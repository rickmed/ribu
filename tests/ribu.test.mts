// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep, wait, race } from "../source/index.mjs"
import { promSleep } from "./utils.mjs"


topic("channels", () => {

   it("can send/receive on channels", async () => {

      let rec = ""

      go(async function main() {

         const ch1 = ch<string>()

         go(async function child() {
            await ch1.put("hi")
         })

         rec = await ch1.rec
      })

      await promSleep(0)
      check(rec).with("hi")
   })
})


topic("process cancellation", () => {

   it.only("ribu automatically cancels child if parent does not wait to be done", async () => {

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


topic.skip("test prc stack", () => {
   it("something", async () => {

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