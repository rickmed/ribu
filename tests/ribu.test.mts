// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore @todo
import { topic, it, check } from "sophi"
import { go, ch, sleep, wait, race } from "../source/index.mjs"
import { promSleep } from "./utils.mjs"

// @todo: change tests to make assertions inside processes when sophi is fixed
// with failing test when no assertions are made.
import csp from "../source/initCsp.mjs"

topic("channels", () => {

   it("works when putter arrives first", async () => {

      let rec: number = 1

      go(async function main() {

         const _ch = ch<number>()

         go(async function child() {
            await _ch.put(2)
            await sleep(1)
            await _ch.put(2 * await _ch.rec)
         })

         rec = await _ch.rec
         await sleep(1)
         await _ch.put(rec * 2)
         rec = await _ch.rec
      })

      await promSleep(3)
      check(rec).with(8)
   })

   it.only("works when receiver arrives first and implicit receive", async () => {

      let rec: number = 1

      go(async function main() {

         const _ch = ch<number>()

         go(async function child() {
            console.log("child: 0", csp.stackHead?._fnName)
            await sleep(1)  // I sleep so main gets to _ch.rec first.
            console.log("child: 1")
            await _ch.put(2)
            console.log("child: 2")
            await sleep(1)
            console.log("child: 3")
            await _ch.put(2 * await _ch)
            console.log("child: 4")
         })

         console.log("main 0", csp.stackHead?._fnName)
         rec = await _ch
         console.log("main 1", {rec})
         console.log(csp.stackHead?._fnName)
         await sleep(1)
         console.log(csp.stackHead?._fnName)
         await _ch.put(rec * 2)
         console.log(csp.stackHead?._fnName)
         rec = await _ch
         console.log(csp.stackHead?._fnName)
      })
console.log("go done")
      await promSleep(4)
      check(rec).with(8)
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