import { go, sleep, E } from "../source/index.mjs"
import { Err } from "../source/errors.mjs"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function* dummyToUseYield() {

	const job = go(function* fn(x?: number) {
		yield sleep(1)
		if (!x) {
			return E("NoNumber")
		}
		if (x < 5) {
			return E("TooLow")
		}
		if (x < 10) {
			return false
		}
		return 1
	})

	/* When using .$, the returned type exclude RibuE types */
	type HappyPath = false | 1
	const x1 = yield* job.$

	check_Eq<HappyPath>()(x1)


	/* When using .ret, the returned type is the natural type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Error from unexpected thrown values.
	*/
	// todo: I don't like Err, change to E<"E"> for consistency
	type ReturnTypeAndRibuErrs = E<"NoNumber"> | E<"TooLow"> | E<"CancOK"> | Err | false | 1
	const x2 = yield* job.err


	check_Eq<ReturnTypeAndRibuErrs>()(x2)


	const x3 = yield* job.cancel()
	check_Eq<undefined>()(x3)

	// todo
	// const x4 = yield* job.cancelHandle()
	// assert2<Equals3<typeof x3, undefined>>()

	// const job2 = go(function* fn(x?: number) {
	// 	yield sleep(1)
	// 	if (!x) return Error("NoNumber")
	// 	if (x < 5) return E("TooLow")
	// 	if (x < 10) return false
	// 	return 1
	// })


	/* If user returns ::Error (not Ribu Error), .err

	*/
	// const res1_job2 = yield* job2.$
	// type
	// check_Eq<undefined>()(x3)
}


type SuperType<S, T extends S> = [S] extends [T] ? T : never

function check_Eq<Exp>() {
	return function <T extends Exp>(rec: SuperType<Exp, T>) {
		rec
	}
}
