// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep, Gen, wait, race } from "../source/index.mjs"
import { promSleep } from "./utils.mjs"


// @todo: put assertions inside all main*()
   // and remove all respective sleepProm()
// now is not possible bc sophi does not fail on tests without ran assertions


topic("process basics", () => {

   it("can sleep without blocking", async () => {

      let mutated = undefined

      go(function* proc1() {
         yield sleep(1)
         mutated = true
      })

      await promSleep(2)
      mutated = false  // this statement should execute last

      check(mutated).with(false)
   })


   it("can yield promises which are resolved", async () => {

      go(function* proc1() {
         const res = yield Promise.resolve(1)
         check(res).with(1)
      })

      await promSleep(1)
   })
})


topic("channels", () => {

   it("can send/receive on channels", async () => {

      let mutated

      const ch1 = ch<boolean>()

      function* child() {
         yield ch1.put(false)
      }

      go(function* main(): Gen<boolean> {
         go(child)
         mutated = yield ch1.rec
      })

      check(mutated).with(false)
   })

   it("can receive implicitly on a channel without using .rec", async () => {

      let mutated

      const ch1 = ch<boolean>()

      function* child() {
         yield ch1.put(false)
      }

      go(function* main(): Gen<boolean> {
         go(child)
         mutated = yield ch1
      })

      check(mutated).with(false)
   })
})


topic("process cancellation", () => {

   it("ribu automatically cancels child if parent does not wait to be done", async () => {

      let mutated = false

      go(function* main() {
         go(function* sleeper() {
            yield sleep(3)
            mutated = true
         })
         yield sleep(1)
      })

      await promSleep(2)

      check(mutated).with(false)
   })
})


topic("process can wait for children processes", () => {

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


topic("race()", () => {

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