// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, Go, ch, sleep, Ch, Gen, wait, waitAll } from "../source/index.mjs"
import { promSleep } from "./utils.mjs"


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

      const ch1 = ch<boolean>()

      function* child() {
         yield ch1.put(false)
      }

      // if you inline the GenFn in go(), the GenFn's args are inferred
      go(function* main(ch): Gen<boolean> {
         go(child)
         const _false = yield ch1.rec
         mutated = _false
      })

      check(mutated).with(false)
   })


   it("can yield promises", async () => {

      function* proc1() {
         const res: number = yield Promise.resolve(1)
         check(res).with(1)
      }

      go(proc1)
      await promSleep(0)
   })

})


topic(`process can access "this" inside them`, () => {

   it("with configured channels", async () => {

      let mutated = false

      Go({ port1: ch<boolean>(2) }, function* main(): Gen<boolean> {
         yield this.port1.put(true)
         mutated = yield this.port1.rec
      })

      await promSleep(0)

      check(mutated).with(true)
   })
})


topic("process cancellation", () => {

   it("ribu automatically cancels child if parent does not wait to be done", async () => {

      let mutated = false

      go(function* main() {
         go(function* sleeper() {
            yield sleep(0)
            mutated = true
         })
      })

      await promSleep(0)

      check(mutated).with(false)
   })
})


topic("process can wait for children processes", () => {

   it.only("explicit waiting. No return values", async () => {

      let mutated = false

      go(function* main() {

         const child = go(function* sleeper() {
            yield sleep(0)
            mutated = true
         })
         yield wait(child).rec
      })

      console.log("dsad")
      await promSleep(0)

      check(mutated).with(true)
   })
})
