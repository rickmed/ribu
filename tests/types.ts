import { go, sleep, E, newJob } from "../source/index.ts"

export function* dummyToUseYield() {

	const job = go(function* fn(x?: number) {
		yield* sleep(1)
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


	/* When using .$, the returned type exclude Error types */
	type Exp1 = false | 1
	const rec1 = yield* job.$
	check_Eq<Exp1>()(rec1)


	/* When using .cont, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Error from thrown values.
	*/
	// todo: I don't like Err, change to E<"E"> for consistency
	type Exp2 = E<"NoNumber"> | E<"TooLow"> | E<"CancOK"> | E<"TimedOut"> | E<"Err"> | false | 1
	const x2 = yield* job.cont
	check_Eq<Exp2>()(x2)

	// todo
	// const x4 = yield* job.cancelHandle()
	// assert2<Equals3<typeof x3, undefined>>()

	// const job2 = go(function* fn(x?: number) {
	// 	yield* sleep(1)
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

export function newJob() {

}

type SuperType<S, T extends S> = [S] extends [T] ? T : never

function check_Eq<Exp>() {
	return function <T extends Exp>(rec: SuperType<Exp, T>) {
		rec
	}
}
