import { go, sleep } from "ribu"
import { Er, Err, type CancOK } from "../source/errors.js"
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
		return Err("Error0")
	}
	return Err("Error1")
}

export function* jobFn2(x?: number) {
	yield* sleep(1)
	if (!x) {
		return "hi"
	}
	return Err("Error2")
}

type NotErr = false | 1 | "hi"
type NotErrs = NotErr[]


export const tests = {

	/* ********** Basic Job Tests ********** */

	*["yield* job: the returned type exclude all Error types"]() {
		type Exp = false | 1
		const _rec = yield* go(jobFn)
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	/* When using .handle, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Err from thrown values.
	*/
	*["yield* job.handle"]() {
		type Exp = false | 1 | Err<"Error0"> | Err<"Error1"> | Er | CancOK
		const _rec = yield* go(jobFn).handle
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* job.cancel()"]() {
		type Exp = void
		const _rec = yield* go(jobFn).cancel()
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* job.cancelErr()"]() {
		type Exp = void | Er
		const _rec = yield* go(jobFn).cancelErr()
		"ok" satisfies Equal<typeof _rec, Exp>
	},


	/* *************** cancel(...jobs) *************************************** */

	*["yield* cancel(...jobs)"]() {
		type Exp = void
		const _rec = yield* cancel(go(jobFn), go(jobFn))
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).maxWait(ms)"]() {
		type Exp = void
		const _rec = yield* cancel(go(jobFn), go(jobFn)).maxWait(1)
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).handle"]() {
		type Exp = void | EmptyArgsErr | Er
		const _rec = yield* cancel(go(jobFn), go(jobFn)).handle
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).maxWait(ms).handle"]() {
		type Exp = void | EmptyArgsErr | Er | TimeoutErr
		const _rec = yield* cancel(go(jobFn), go(jobFn)).maxWait(1).handle
		"ok" satisfies Equal<typeof _rec, Exp>
	},


	/* *************** allOrErr() ******************************************** */

	*["yield* allOrErr()"]() {
		type Exp = NotErrs
		const _rec = yield* allOrErr(go(jobFn), go(jobFn2))
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* allOrErr().maxWait(ms)"]() {
		type Exp = NotErrs
		const _rec = yield* allOrErr(go(jobFn), go(jobFn2)).maxWait(1)
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* allOrErr().handle"]() {
		type Exp = NotErrs | JobHadErr | EmptyArgsErr
		const _rec = yield* allOrErr(go(jobFn), go(jobFn2)).handle
		"ok" satisfies Equal<typeof _rec, Exp>
	},

	*["yield* allOrErr().maxWait(ms).handle"]() {
		type Exp = NotErrs | JobHadErr | EmptyArgsErr | TimeoutErr
		const _rec = yield* allOrErr(go(jobFn), go(jobFn2)).maxWait(1).handle
		"ok" satisfies Equal<typeof _rec, Exp>
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


type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends
	(<T>() => T extends B ? 1 : 2)
		? (<T>() => T extends B ? 1 : 2) extends
			(<T>() => T extends A ? 1 : 2)
			? true
			: false
		: false

type Equal<Rec, Exp> =
	IsEqual<Rec, Exp> extends true ?
	"ok" :
	{ error: "Type mismatch", rec: Rec, exp: Exp }
