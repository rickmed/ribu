import { Err as newErr, go, sleep } from "ribu"
import { Er, Err, type CancOK } from "../source/errors.js"
import { cancel, Timeout } from "../source/job.js"
import { allOrErr2 } from "../source/job-helpers.js"

function* jobFn(x?: number) {
	yield* sleep(1)
	if (!x) {
		return false
	}
	if (x < 5) {
		return 1
	}
	if (x < 10) {
		return newErr("Error0")
	}
	return newErr("Error1")
}

function* jobFn2(x?: number) {
	yield* sleep(1)
	if (!x) {
		return "hi"
	}
	return newErr("Error2")
}

type NotErr = false | 1 | "hi"
type NotErrs = NotErr[]


export const tests = {

	/* ********** Basic Job Tests ********** */

	*["yield* job: the returned type exclude all Error types"]() {
		type Exp1 = false | 1
		const rec = yield* go(jobFn)
		check_Eq<Exp1>()(rec)
	},

	/* When using .err, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Err from thrown values.
	*/
	*["yield* job.err"]() {
		type Exp = false | 1 | Err<"Error1"> | Err<"Error2"> | Er | CancOK
		const rec = yield* go(jobFn).err
		check_Eq<Exp>()(rec)
	},

	*["yield* job.cancel()"]() {
		type Exp = void
		const rec = yield* go(jobFn).cancel()
		check_Eq<Exp>()(rec)
	},

	*["yield* job.cancelErr()"]() {
		type Exp = void | Er
		const rec = yield* go(jobFn).cancelErr()
		check_Eq<Exp>()(rec)
	},


	/* *************** cancel(...jobs) *************************************** */

	*["yield* cancel(...jobs)"]() {
		type Exp = void
		const rec = yield* cancel(go(jobFn), go(jobFn))
		check_Eq<Exp>()(rec)
	},

	*["yield* cancel(...jobs).maxWait(ms)"]() {
		type Exp = void
		const rec = yield* cancel(go(jobFn), go(jobFn)).maxWait(1)
		check_Eq<Exp>()(rec)
	},

	*["yield* cancel(...jobs).err"]() {
		type Exp = void | Er | Timeout
		const rec = yield* cancel(go(jobFn), go(jobFn)).err
		check_Eq<Exp>()(rec)
	},

	*["yield* cancel(...jobs).maxWait(ms).err"]() {
		type Exp = void | Er | Timeout
		const rec = yield* cancel(go(jobFn), go(jobFn)).maxWait(1).err
		check_Eq<Exp>()(rec)
	},


	/* *************** allOrErr() ******************************************** */

	*["yield* allOrErr()"]() {
		type Exp = NotErrs
		const rec = yield* allOrErr2(go(jobFn), go(jobFn2))
		check_Eq<Exp>()(rec)
	},

	*["yield* allOrErr().err"]() {
		type Exp = NotErrs | Err<"JobHadErr"> | Err<"EmptyArguments">
		const rec = yield* allOrErr2(go(jobFn), go(jobFn2)).err
		check_Eq<Exp>()(rec)
	},

	// todo: not sure if can be cancelled
	// *["yield* allOrErr().cancel()"]() {
	// 	type Exp = void
	// 	const rec = yield* allOrErr2(go(jobFn), go(jobFn2)).cancel()
	// 	check_Eq<Exp>()(rec)
	// },

	// *["yield* allOrErr().cancelErr()"]() {
	// 	type Exp = void | Er
	// 	const rec = yield* allOrErr2(go(jobFn), go(jobFn2)).cancelErr()
	// 	check_Eq<Exp>()(rec)
	// },
}


type SuperType<S, T extends S> = [S] extends [T] ? T : never

function check_Eq<Exp>() {
	return function <T extends Exp>(_rec: SuperType<Exp, T>) {
	}
}
