import { EmptyArgsErr, JobPlus, SETTLED_OR_CANCELLED } from "./job-helpers.js"
import { addErrorToJob, ERR_IN_GENFN, type _Job, Job, ERR_IN_ONEND, CANCELLED, markSettledAndNotifyObs, unlinkFromAllJobs } from "./job.js"
import { type Err } from "./errors.js"
import { VOID_LINK } from "./system.js"

export const CANCEL_ALL_OP_NAME = "cancel"

class CancelAll<Ok, E> extends JobPlus<Ok, E | EmptyArgsErr> {
	_nm = CANCEL_ALL_OP_NAME

	// todo: maybe have a custom cancelHandleErr type
	_onTgDone(tgJob: _Job): void {
		this._onOkTgDone(tgJob)
		if (this._tg === VOID_LINK) {
			this._settleJob()
		}
	}

	_onOkTgDone(tgJob: _Job): void {
		if (tgJob._st & ERR_IN_ONEND) {
			addErrorToJob(this, tgJob._v as Err, ERR_IN_GENFN)
		}
	}

	_cancel() {
		if (this._st & SETTLED_OR_CANCELLED) {
			return
		}
		this._st |= CANCELLED
		unlinkFromAllJobs(this)
		markSettledAndNotifyObs(this)
	}
}

export function cancel(jobs: Job[]) {
	const x = new CancelAll<void, Err>()._go(jobs, true)
	return x as Job<void, EmptyArgsErr | Err>
}
