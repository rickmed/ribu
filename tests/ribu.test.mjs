// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep } from "../source/index.mts"
import { promSleep } from "./utils.mts"

/**
 * @template [TChVal=undefined]
 * @typedef {Ribu.Ch<TChVal>} Ch<TChVal>
 */

topic("process basics", () => {

   it("it sleep without blocking", async () => {

      let mutated = undefined

      go(function* proc1() {
         yield sleep(0)
         mutated = true
      })

      await promSleep(1)
      mutated = false  // this statement should execute last

      check(mutated).with(false)
   })


   it("can send/receive on channels", async () => {
      // @todo: put assertion inside main()
      // now is not possible bc sophi does not fail on tests without ran assertions

      let mutated

      const ch1 = /** @type {Ch<boolean>} */(ch())

      /** @type {(ch: Ch<boolean>) => Ribu.Gen} */
      function* child(ch) {
         yield ch.put(false)
      }

      // type parameter of Ch makes no difference at ch.take bc generators can't connect next() with yield
      /** @type {(ch: Ch<boolean>) => Ribu.Gen<boolean>} */
      function* main(ch) {
         go(child(ch))
         const _false = yield ch.rec
         mutated = _false
      }

      go(main(ch1))

      check(mutated).with(false)
   })


   it("can yield promises", async () => {

      /** @type {() => Ribu.Gen<number>} */
      function* proc1() {
         const res = yield Promise.resolve(1)
         check(res).with(1)
      }

      go(proc1)
      await promSleep(0)
   })

})


topic.skip(`process can access "this" inside them`, () => {

   it("with configured channels", async () => {

      let mutated = false

      /** @this {Ribu.Proc<{port1: Ch<boolean>}>} */
      function* main() {
         yield this.port1.put(true)
         const _true = /** @type {boolean} */ (yield this.port1.rec)
         mutated = _true
      }

      go(main, {port1: ch(2)})

      await promSleep(0)

      check(mutated).with(true)
   })
})


topic("process cancellation", () => {

   it("ribu automatically cancels child if parent does not wait to be done", async () => {

      let mutated = false

      go(function* main() {  // eslint-disable-line require-yield
         go(function* sleeper() {
            yield sleep(1)
            mutated = true
         })
      })

      check(mutated).with(false)
   })
})



topic.skip("process can wait for children processes", () => {

   it("implicit waiting. No return values", async () => {

      let mutated = false

      go(function* main() {  // eslint-disable-line require-yield
         go(function* sleeper() {
            yield sleep(1)
            mutated = true
         })

         // yield wait
      })

      check(mutated).with(true)
   })
})
