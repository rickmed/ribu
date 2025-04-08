import { EMPTY_ARGS, JobPlus } from "./job-helpers.js"
import { addErrorToJobVal, ERR_IN_GENFN, type _Job, Job, ERR_IN_ONEND } from "./job.js"
import { type Er, type Err } from "./errors.js"
import { VOID_LINK } from "./system.js"

export const CANCEL_ALL_OP_NAME = "cancel"

class CancellAll<Ok, E> extends JobPlus<Ok, E | Err<typeof EMPTY_ARGS>> {
	_nm = CANCEL_ALL_OP_NAME

	// todo: have a custom cancelErr type
	_onTgDone(tgJob: _Job): void {
		this._onTgDoneExec(tgJob)
		if (this._tg === VOID_LINK) {
			this._settleJob()
		}
	}

	_onTgDoneExec(tgJob: _Job): void {
		if (tgJob._st & ERR_IN_ONEND) {
			addErrorToJobVal(this, tgJob._v as Er, ERR_IN_GENFN)
		}
	}
}

export function cancel(jobs: Job[]) {
	return new CancellAll<void, Er>()._go(jobs, true)
}


// export function addErrorToJobVal(thisJob: _Job, err: Error, errFlag: _Job["_st"]) {
// 	if (!(thisJob._st & HAD_ERR)) {
// 		thisJob._v = _Err(thisJob._nm)
// 	}
// 	const errVal = thisJob._v as Er
// 	if (errFlag & ERR_IN_GENFN) {
// 		errVal._addErr(err)
// 	}
// 	else {
// 		errVal._addOnEndErr(err)
// 	}
// 	thisJob._st |= errFlag
// 	return errVal
// }