describe.skip("race()", () => {

	it("when all processes finish succesfully", async () => {

		let won = ""

		go(async () => {

			async function one() {
				await wait(2)
				won = "one"
			}

			async function two() {
				await wait(1)
				won = "two"
			}

			await race(go(one), go(two)).rec
		})

		await promSleep(3)
		check_Eq(won).with("two")
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
