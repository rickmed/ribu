import { go, sleep } from "ribu"
import { Er, Err, UserErrCtor as newErr, type CancOK } from "../source/errors.js"
import { cancel } from "../source/cancelAllJobs.js"
import { allOrErr, EmptyArgsErr, JobHadErr, TimeoutErr } from "../source/job-helpers.js"

export function* jobFn(x?: number) {
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

export function* jobFn2(x?: number) {
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
		type Exp = false | 1
		const rec = yield* go(jobFn)
		check_Eq<Exp>()(rec)
	},

	/* When using .handle, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Err from thrown values.
	*/
	*["yield* job.handle"]() {
		type Exp = false | 1 | Err<"Error0"> | Err<"Error5"> | Er | CancOK
		const rec = yield* go(jobFn).handle
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

	*["yield* cancel(...jobs).handle"]() {
		type Exp = void | EmptyArgsErr | Er
		const rec = yield* cancel(go(jobFn), go(jobFn)).handle
		check_Eq<Exp>()(rec)
	},

	*["yield* cancel(...jobs).maxWait(ms).handle"]() {
		type Exp = void | EmptyArgsErr | Er | TimeoutErr
		const rec = yield* cancel(go(jobFn), go(jobFn)).maxWait(1).handle
		check_Eq<Exp>()(rec)
	},


	/* *************** allOrErr() ******************************************** */

	*["yield* allOrErr()"]() {
		type Exp = NotErrs
		const rec = yield* allOrErr(go(jobFn), go(jobFn2))
		check_Eq<Exp>()(rec)
	},

	*["yield* allOrErr().maxWait(ms)"]() {
		type Exp = NotErrs
		const rec = yield* allOrErr(go(jobFn), go(jobFn2)).maxWait(1)
		check_Eq<Exp>()(rec)
	},

	*["yield* allOrErr().handle"]() {
		type Exp = NotErrs | JobHadErr | EmptyArgsErr
		const rec = yield* allOrErr(go(jobFn), go(jobFn2)).handle
		check_Eq<Exp>()(rec)
	},

	*["yield* allOrErr().maxWait(ms).handle"]() {
		type Exp = NotErrs | JobHadErr | EmptyArgsErr | TimeoutErr
		const rec = yield* allOrErr(go(jobFn), go(jobFn2)).maxWait(1).handle
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


type IsNever<T> = [T] extends [never] ? true : false

type Without<T, U> = T extends U ? never : T

type SymDiff<T, U> = Without<T, U> | Without<U, T>

type Exact<T, U> =
	IsNever<SymDiff<T, U>> extends true
		? ([T] extends [U] ? ([U] extends [T] ? T : never) : never)
		: never

function check_Eq<T>() {
	return <U>(_v: Exact<T, U>) => {}
}