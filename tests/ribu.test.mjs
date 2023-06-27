// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep } from "../source/ribu.mjs"
import { promSleep } from "./utils.mjs"

topic("processes basics", () => {

   const waitms = 0

   it("can wait", async () => {

      let processMutatedMe = false

      function* proc1() {
         yield sleep(waitms)
         processMutatedMe = true
      }

      go(proc1)

      await promSleep(waitms)

      check(processMutatedMe).with(true)
   })


   it("can yield channels send/receive", async () => {

      /** @type {number} */
      let processMutatedMe = 0

      /** @type {(ch: Ribu.Ch<number>) => Ribu.Gen} */
      function* proc1(ch) {
         yield ch.put(1)
      }

      // type parameter of Ch makes no difference on ch.take bc generators can't connect next() with yield
      /** @type {(ch: Ribu.Ch<number>) => Ribu.Gen<number>} */
      function* proc2(ch) {
         const one = yield ch.rec
         yield sleep(waitms)
         processMutatedMe = one
      }

      const ch1 = /** @type {Ribu.Ch<number>} */(ch())
      go(proc1(ch1))
      go(proc2(ch1))

      await promSleep(waitms)

      check(processMutatedMe).with(1)
   })


   it("can yield promises", async () => {

      let processMutatedMe = false

      /** @type {() => Ribu.Gen<boolean>} */
      function* proc1() {
         const res = yield sleep(waitms)
         processMutatedMe = res
      }

      go(proc1)

      await promSleep(waitms)

      check(processMutatedMe).with(true)
   })

})


topic("process cancellation", () => {

   it("manual/simple proc cancel", async () => {

      let mutated = false

      go(function*() {
         const childProc = go(function*() {
            yield sleep(1)
            mutated = true
         })

         yield sleep(0)
         yield childProc.cancel().rec
      })

      await promSleep(0)

      check(mutated).with(false)
   })
})
