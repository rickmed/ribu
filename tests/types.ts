import { CancOK, Err as newErr, go, sleep, allOrErr } from "ribu"
import { EmptyArgsErr } from "../source/job-helpers.ts"
import { Err } from "../source/errors.ts"

function* jobFn(x?: number) {
	yield* sleep(1)
	if (!x) {
		return false
	}
	if (x < 5) {
		return 1
	}
	if (x < 10) {
		return newErr("Error1")
	}
	return newErr("Error2")
}

type NotErrs = false | 1
type All = NotErrs | Err<"Error1"> | Err<"Error2"> | Err<string> | CancOK

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tests = {

	/* ********** Basic Job Tests ********** */

	*["yield* job: the returned type exclude all Error types"]() {
		type Exp1 = false | 1
		const rec1 = yield* go(jobFn)
		check_Eq<Exp1>()(rec1)
	},

	/* When using .err, the returned type is the type returned from the
		generator function, plus ECancOK (in case the job was cancelled) and the
		generic Ribu Err from thrown values.
	*/
	*["yield* job.err"]() {
		const x2 = yield* go(jobFn).err
		check_Eq<All>()(x2)
	},

	*["yield* job.cancel()"]() {
		type Exp = CancOK
		const x3 = yield* go(jobFn).cancel()
		check_Eq<Exp>()(x3)
	},

	*["yield* job.cancelErr()"]() {
		type Exp = CancOK
		const x3 = yield* go(jobFn).cancelErr()
		check_Eq<Exp>()(x3)
	},


	/* *************** allOrErr() ************************************* */

	*["yield* allOrErr()"]() {
		type Exp = NotErrs[]
		const x3 = yield* allOrErr(go(jobFn), go(jobFn))
		check_Eq<Exp>()(x3)
	},

	*["yield* allOrErr().err"]() {
		type Exp = NotErrs[] | EmptyArgsErr | Err<string>
		const x3 = yield* allOrErr(go(jobFn), go(jobFn)).err
		check_Eq<Exp>()(x3)
	},

	*["yield* allOrErr().cancel()"]() {
		type Exp = CancOK
		const x3 = yield* allOrErr(go(jobFn), go(jobFn)).cancel()
		check_Eq<Exp>()(x3)
	},
}



type SuperType<S, T extends S> = [S] extends [T] ? T : never

function check_Eq<Exp>() {
	return function <T extends Exp>(_rec: SuperType<Exp, T>) {
	}
}
