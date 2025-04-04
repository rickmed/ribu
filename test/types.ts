import { go, sleep } from "ribu"
import { Er, Err, type ECancOk } from "../source/errors.js"
import { cancel } from "../source/cancelAllJobs.js"
import { allOrErr, EmptyArgsErr, JobHadErr, TimeoutErr, groupByState } from "../source/job-helpers.js"
import {type OkJob, type ErrJob, DoneJob, type ByStateJobBase, Job } from "../source/job.js"

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

type RibuErrs = Er | ECancOk

type ErrsJob1 = Err<"Error0"> | Err<"Error1">
type AllErrsJob1 = ErrsJob1 | RibuErrs
type OksJob1 = false | 1
type AllJob1 = OksJob1 | AllErrsJob1

type ErrsJob2 = Err<"Error2">
type AllErrsJob2 = ErrsJob2 | RibuErrs
type OksJob2 = "hi" | SomeObj

type NotErr = OksJob1 | OksJob2
type NotErrs = NotErr[]


export const tests = {

	/* ********** Basic Job Tests ********** */

	*["yield* job: the returned type exclude all Error types"]() {
		type Exp = OksJob1
		const _rec = yield* go(jobFn1)
		true satisfies Equal<typeof _rec, Exp>
	},

	/* When using .handle, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Err from thrown values.
	*/
	*["yield* job.handle"]() {
		type Exp = OksJob1 | AllErrsJob1
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
		const _rec = yield* go(jobFn1).cancelHandle()
		true satisfies Equal<typeof _rec, Exp>
	},

	["job variants using type guard methods"]() {
		const job = go(jobFn1)

		if (job.isDone()) {
			checkDoneJob(job)
		}
		if (job.isOk()) {
			checkOkJob(job)
		}
		if (job.isErr()) {
			checkErrJob(job)
		}

		const jobs = [go(jobFn1), go(jobFn2)]

		const ok = jobs.filter(j => j.isOk())
		const err = jobs.filter(j => j.isErr())
		const done = jobs.filter(j => j.isDone())

		true satisfies Equal<
			typeof ok,
			(OkJob<OksJob1> | OkJob<OksJob2>)[]
		>

		true satisfies Equal<
			typeof err,
			(ErrJob<AllErrsJob1> | ErrJob<AllErrsJob2>)[]
		>

		true satisfies Equal<
			typeof done,
			(DoneJob<OksJob1, AllErrsJob1> | DoneJob<OksJob2, AllErrsJob2>)[]
		>

		const _okVals = ok.map(j => j.val)
		true satisfies Equal<typeof _okVals, (OksJob1 | OksJob2)[]>

		const _errVals = err.map(j => j.reason)
		true satisfies Equal<typeof _errVals, (AllErrsJob1 | AllErrsJob2)[]>

		const _liveJobs = done.map(j => j.st)
		true satisfies Equal<typeof _liveJobs, "done"[]>
	},

	["job variants (exhaustive) using job.byState()"]() {
		const job = go(jobFn1)

		const _job = job.byState()

		if (_job.st === "ok") {
			checkOkJob(_job)
			return
		}
		if (_job.st === "err") {
			checkErrJob(_job)
			return
		}
		if (_job.st === "done") {
			checkDoneJob(_job)
			return
		}

		_job satisfies never
	},

	["job ctx"]() {
		const job = go(jobFn1)
		true satisfies Equal<typeof job.ctx, unknown>

		const _sameJobRef = job.setCtx(false)
		true satisfies Equal<typeof _sameJobRef.ctx, boolean>
	},

	/* *************** cancel(...jobs) *************************************** */

	*["yield* cancel(...jobs)"]() {
		type Exp = void
		const _rec = yield* cancel(go(jobFn1), go(jobFn2))
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).maxWait(ms)"]() {
		type Exp = void
		const _rec = yield* cancel(go(jobFn1), go(jobFn2)).maxWait(1)
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).handle"]() {
		type Exp = void | EmptyArgsErr | Er
		const _rec = yield* cancel(go(jobFn1), go(jobFn2)).handle
		true satisfies Equal<typeof _rec, Exp>
	},

	*["yield* cancel(...jobs).maxWait(ms).handle"]() {
		type Exp = void | EmptyArgsErr | Er | TimeoutErr
		const _rec = yield* cancel(go(jobFn1), go(jobFn2)).maxWait(1).handle
		true satisfies Equal<typeof _rec, Exp>
	},


	/* *************** groupByState() ******************************************** */

	["groupByState()"]() {
		const jobs = [go(jobFn1), go(jobFn2)]
		const { live: _live, ok, err } = groupByState(jobs)

		true satisfies Equal<
			typeof _live,
			(Job<OksJob1, AllErrsJob1> | Job<OksJob2, AllErrsJob2>)[]
		>

		true satisfies Equal<
			typeof ok,
			(OkJob<OksJob1> | OkJob<OksJob2>)[]
		>

		true satisfies Equal<
			typeof err,
			(ErrJob<AllErrsJob1> | ErrJob<AllErrsJob2>)[]
		>

		const _okVals = ok.map(j => j.val)
		true satisfies Equal<typeof _okVals, (OksJob1 | OksJob2)[]>

		const _errVals = err.map(j => j.reason)
		true satisfies Equal<typeof _errVals, (AllErrsJob1 | AllErrsJob2)[]>
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

type Not<T extends boolean> = T extends true ? false : true;

type HasKey<T, K extends string> = K extends keyof T ? true : false;


function checkOkJob(_job: OkJob<OksJob1>) {
	true satisfies Equal<typeof _job.st, "ok">
	true satisfies Equal<typeof _job.val, OksJob1>
	true satisfies Not<HasKey<typeof _job, "reason">>
	true satisfies Not<HasKey<typeof _job, "done">>
	true satisfies (typeof _job) extends ByStateJobBase ? true : false
}

function checkErrJob(_job: ErrJob<AllErrsJob1>) {
	true satisfies Equal<typeof _job.st, "err">
	true satisfies Equal<typeof _job.reason, AllErrsJob1>
	true satisfies Not<HasKey<typeof _job, "val">>
	true satisfies Not<HasKey<typeof _job, "done">>
	true satisfies (typeof _job) extends ByStateJobBase ? true : false
}

function checkDoneJob(_job: DoneJob<OksJob1, AllErrsJob1>) {
	true satisfies Equal<typeof _job.st, "done">
	true satisfies Equal<typeof _job.val, AllJob1>
	true satisfies Not<HasKey<typeof _job, "reason">>
	true satisfies Not<HasKey<typeof _job, "done">>
	true satisfies (typeof _job) extends ByStateJobBase ? true : false
}