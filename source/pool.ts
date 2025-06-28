import { _Job, Job, removeTgLink, removeOb, linkJobs, SETTLED, resumeJob, JobsLink } from "./job.js"
import { disposeLink, freshLink, iterRes, Link, sys, SYS_ITERATOR, SysIterator, VOID_LINK } from "./system.js"

/** _Pool Class
 *  _v:
 * 	Count for jobs in pool (done that haven't been yield* or in-flight)
 *  _nm:
 *		"Pool"
 *  _st:
 * 	Pool state.
 *  _gn:
 * 	Not used
 *  _ob:
 * 	LL of observers observing this Pool.
 *  _tg:
 *		LL of in-flight jobs.
 *  _pr:
 * 	Already done jobs that haven't been pulled yet (using yield*)
 *  _oe:
 * 	Not used
 *  _tm:
 * 	Not used
 *  _ctx:
 * 	Not used
 */
export class _Pool<Jobs> extends _Job {
	_v: number

	constructor(jobs: Job[]) {
		super("Pool")
		const jobsLen = jobs.length
		this._v = jobsLen
		for (let i = 0; i < jobsLen; i++) {
			const job = jobs[i] as unknown as _Job
			if (job._st && SETTLED) {
				this._addDoneJob(job)
			}
			else {
				linkJobs(this, job)
			}
		}
	}

	// _addDoneJob() and _pullDoneJob() forms a singly LL LIFO.
	_addDoneJob(job: _Job) {
		// link.b is not used but set job there also to keep types happy.
		const link = freshLink(job, job)
		let head = this._pr
		this._pr = link
		if (head !== VOID_LINK) {
			link.nA = head
		}
	}

	_pullDoneJob(doneJobsLLHead: JobsLink) {
		const job = doneJobsLLHead.a
		this._pr = doneJobsLLHead.nA
		disposeLink(doneJobsLLHead)
		return job
	}

	_onTgDone(tgJob: _Job): void {
		let obLink = this._ob
		if (obLink === VOID_LINK) {
			this._addDoneJob(tgJob)
			return
		}
		do {
			const nextLink = obLink.nA
			const observer = obLink.a
			removeOb(this, obLink)
			removeTgLink(observer as _Job, obLink)
			disposeLink(obLink)
			resumeJob(observer as _Job, tgJob)
			obLink = nextLink
			this._v--
		} while (obLink !== VOID_LINK)
	}

	[Symbol.iterator]() {
		const doneJobsLLHead = this._pr
		if (doneJobsLLHead !== VOID_LINK) {
			const job = this._pullDoneJob(doneJobsLLHead as JobsLink)
			iterRes.done = true
			iterRes.value = job
		}
		else {
			let callerJob = sys.runningJob
			linkJobs(callerJob, this)
			iterRes.done = false
		}
		return SYS_ITERATOR as SysIterator<Jobs>
	}

	go() {
		// maybe use go() function here
		this._v++
	}

	add() {
		this._v++
	}

	// Reuse _v property from parent Class
	get size() {
		return this._v
	}
}

type Pool<JobsUnion> = _Pool<JobsUnion>

export function Pool<Jobs extends Job[]>(jobs: Jobs) {
	return new _Pool(jobs) as unknown as Pool<Jobs[number]>
}