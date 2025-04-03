import { go, sleep } from "ribu"
import { Er, Err, type ECancOk } from "../source/errors.js"
import { cancel } from "../source/cancelAllJobs.js"
import { allOrErr, EmptyArgsErr, JobHadErr, TimeoutErr, isOk, groupByState } from "../source/job-helpers.js"
import { type Job, type OkJob, type ErrJob } from "../source/job.js"

export function* jobFn1(x?: number) {
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

type SomeObj = {c: number}

export function* jobFn2(x?: number) {
	yield* sleep(1)
	if (!x) {
		return "hi"
	}
	if (x < 10) {
		const obj: SomeObj = {c: 56}
		return obj
	}
	return Err("Error2")
}


const job = go(jobFn1)

if (job.is("ok")) {
	job
}
else if (job.is("err")) {
	const err = job.reason
}
else {
	const c = job.v
}



const jobCtx = job.setCtx(false)

const val = jobCtx.val

if (jobCtx.is("ok")) {
	const c = jobCtx.ctx
	const val = jobCtx.val
	const done = jobCtx.done
	if (jobCtx.is("err")) {
		const val = jobCtx.val
	}
}

if (jobCtx.is("err")) {
	const err = jobCtx.reason
}


if (isOk(job)) {
	const val = job.val
}

const job2 = go(jobFn2)
const _jobs = [jobCtx, job2]

const doneOKJobs = _jobs
	// .filter(isOk)
	.filter(j => j.is("ok"))

const grouped = groupByState(_jobs)
const doneOk = grouped.doneOk
	.map(j => j.val)
const doneErr = grouped.doneErr
	.map(j => j.reason)
const notDone = grouped.notDone

type RibuErrs = Er | ECancOk
type ErrsJob1 = Err<"Error0"> | Err<"Error1">
type AllErrsJob1 = ErrsJob1 | RibuErrs
type NotErrsJob1 = false | 1
type AllJob1 = NotErrsJob1 | AllErrsJob1
type NotErr = false | 1 | "hi"
type NotErrs = NotErr[]



export const tests = {

	/* ********** Basic Job Tests ********** */

	*["yield* job: the returned type exclude all Error types"]() {
		type Exp = NotErrsJob1
		const _rec = yield* go(jobFn1)
		true satisfies Equal<typeof _rec, Exp>
	},

	/* When using .handle, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Err from thrown values.
	*/
	*["yield* job.handle"]() {
		type Exp = NotErrsJob1 | AllErrsJob1
		const _rec = yield* go(jobFn1).handle
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* job.cancel()"]() {
		type Exp = void
		const _rec = yield* go(jobFn1).cancel()
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* job.cancelErr()"]() {
		type Exp = void | Er
		const _rec = yield* go(jobFn1).cancelErr()
		true satisfies Equal<typeof _rec, Exp>
	},

	["job states using job.is()"]() {
		const job = go(jobFn1)
		if (job.is("ok")) {
			const _val = job.val
			true satisfies Equal<typeof job, OkJob<NotErrsJob1>>
			true satisfies Equal<typeof _val, NotErrsJob1>
		}
		else if (job.is("err")) {
			const _err = job.reason
			true satisfies Equal<typeof job, ErrJob<AllErrsJob1>>
			true satisfies Equal<typeof _err, AllErrsJob1>
		}
		else {
			// const c = job.v
			true satisfies Equal<typeof job, Job<NotErrsJob1, AllJob1>>
		}

		job satisfies never
	},


	/* *************** cancel(...jobs) *************************************** */

	*["yield* cancel(...jobs)"]() {
		type Exp = void
		const _rec = yield* cancel(go(jobFn1), go(jobFn1))
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).maxWait(ms)"]() {
		type Exp = void
		const _rec = yield* cancel(go(jobFn1), go(jobFn1)).maxWait(1)
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).handle"]() {
		type Exp = void | EmptyArgsErr | Er
		const _rec = yield* cancel(go(jobFn1), go(jobFn1)).handle
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).maxWait(ms).handle"]() {
		type Exp = void | EmptyArgsErr | Er | TimeoutErr
		const _rec = yield* cancel(go(jobFn1), go(jobFn1)).maxWait(1).handle
		true satisfies Equal<typeof _rec, Exp>
	},


	/* *************** allOrErr() ******************************************** */

	*["yield* allOrErr()"]() {
		type Exp = NotErrs
		const _rec = yield* allOrErr(go(jobFn1), go(jobFn2))
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* allOrErr().maxWait(ms)"]() {
		type Exp = NotErrs
		const _rec = yield* allOrErr(go(jobFn1), go(jobFn2)).maxWait(1)
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* allOrErr().handle"]() {
		type Exp = NotErrs | JobHadErr | EmptyArgsErr
		const _rec = yield* allOrErr(go(jobFn1), go(jobFn2)).handle
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* allOrErr().maxWait(ms).handle"]() {
		type Exp = NotErrs | JobHadErr | EmptyArgsErr | TimeoutErr
		const _rec = yield* allOrErr(go(jobFn1), go(jobFn2)).maxWait(1).handle
		true satisfies Equal<typeof _rec, Exp>
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
	true :
	{ error: "Type mismatch", rec: Rec, exp: Exp }
