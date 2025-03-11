import { ECancOK, Err } from "../source/errors.ts"
import { go, sleep, E, cancel} from "../source/index.ts"

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tests = {

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
		type Exp2 = false | 1 | E<"Error1"> | E<"Error2"> | ECancOK | Err
		const x2 = yield* go(jobFn).err
		check_Eq<Exp2>()(x2)
	},

	*["yield* job.cancel()"]() {
		type Exp3 = ECancOK
		const x3 = yield* go(jobFn).cancel()
		check_Eq<Exp3>()(x3)
	},


	*["yield* cancel(jobs)"]() {
		type Exp3 = ECancOK
		const x3 = yield* cancel(go(jobFn), go(jobFn))
		check_Eq<Exp3>()(x3)
	},

}

type SuperType<S, T extends S> = [S] extends [T] ? T : never

function check_Eq<Exp>() {
	return function <T extends Exp>(_rec: SuperType<Exp, T>) {
	}
}
