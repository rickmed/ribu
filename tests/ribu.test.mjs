// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, Ch, wait } from "../source/ribu.mjs"
import { sleep } from "./utils.mjs"


topic("processes", () => {

   const waitms = 0

   it("can wait", async () => {

      let processMutatedMe = false

      function* proc1() {
         yield wait(waitms)
         processMutatedMe = true
      }

      go(proc1)

      await sleep(waitms)

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
      /** @type {(ch: Ribu.Ch) => Ribu.Gen<number>} */
      function* proc2(ch) {
         const one = yield ch.rec
         yield wait(waitms)
         processMutatedMe = one
      }

      const ch = Ch()
      go(proc1(ch))
      go(proc2(ch))

      await sleep(waitms)

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

      await sleep(waitms)

      check(processMutatedMe).with(true)
   })
})
