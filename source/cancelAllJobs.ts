import { EmptyArgsErr, JobPlus } from "./job-helpers.js"
import { addErrorToJobVal, ERR_IN_GENFN, type _Job, Job, ERR_IN_ONEND } from "./job.js"
import { type Err } from "./errors.js"
import { VOID_LINK } from "./system.js"

export const CANCEL_ALL_OP_NAME = "cancel"

class CancellAll<Ok, E> extends JobPlus<Ok, E | EmptyArgsErr> {
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
			addErrorToJobVal(this, tgJob._v as Err, ERR_IN_GENFN)
		}
	}
}

export function cancel(jobs: Job[]) {
	return new CancellAll<void, Err>()._go(jobs, true)
}
