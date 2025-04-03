import { ExtendJobPlus } from "./job-helpers.js"
import { addErrorToJobVal, ERR_IN_ONEND, ERR_IN_GENFN, type _Job } from "./job.js"
import { type Er } from "./errors.js"

// 	return cancelJobs as Pick<CancelAll, "err" | typeof Symbol.iterator | "maxWait">

export const CANCEL_ALL_OP_NAME = "cancel(...jobs)"
export const cancel = ExtendJobPlus(CANCEL_ALL_OP_NAME, onTgJobDone, undefined, true)

function onTgJobDone<Jobs extends _Job[]>(this: _Job, tgJob: Jobs[number]): void | Er {
	if (tgJob._st & ERR_IN_ONEND) {
		return addErrorToJobVal(this, tgJob._v as Er, ERR_IN_GENFN)
	}
}