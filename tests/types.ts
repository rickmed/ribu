import { ECancOK, Err, type E as EType } from "../source/errors.ts"
import { go, sleep, E} from "../source/index.ts"
import { EmptyArgsErr, allOrErr } from "../source/job-helpers.ts"
import { NotErrs } from "../source/job.ts"

function* jobFn(x?: number) {
	yield sleep(1)
	if (!x) {
		return false
	}
	if (x < 5) {
		return 1
	}
	if (x < 10) {
		return E("Error1")
	}
	return E("Error2")
}

type All = false | 1 | E<"Error1"> | E<"Error2"> | ECancOK | Err

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
		type Exp = ECancOK
		const x3 = yield* go(jobFn).cancel()
		check_Eq<Exp>()(x3)
	},


	/* ********** Job Helpers Tests ********** */

	*["yield* allOrErr()"]() {
		type Exp = Array<NotErrs<All>>
		const x3 = yield* allOrErr(go(jobFn), go(jobFn))
		check_Eq<Exp>()(x3)
	},
	*["yield* allOrErr().err"]() {
		type Exp = Array<NotErrs<All>> | EmptyArgsErr | Err
		const x3 = yield* allOrErr(go(jobFn), go(jobFn)).err
		check_Eq<Exp>()(x3)
	},
}



type SuperType<S, T extends S> = [S] extends [T] ? T : never

function check_Eq<Exp>() {
	return function <T extends Exp>(_rec: SuperType<Exp, T>) {
	}
}
