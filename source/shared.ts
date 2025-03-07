import { Chan } from "./channel.ts"
import { type Job } from "./job.ts"



/* When removing nodes from counterpart

		target.llHead
					\
 undefined <-> [] <-> [] <-> [] <-> undefined
					|		 |
					|	  if removing this, no problem, prev and next will point to each other
					|
	          if removing head, need to update target.llHead to removingLink.next

*/


/* Should tail/heads wrap so Links p/n are never undefined? (no need to check)

	adding B:

		target.llHead
					\
			EL <-> A <-> EL

		target.llHead
				\
		EL <-> B <-> A <-> EL

** In channels need head.prev to point to tail (instead of EL)
		so it can be dequeued from tail (queues in head)
	- Consider this when removing links from Channel queues


*/

/* Subscribe to
When target is done, it removes itself from observer's _tgH and calls ._onTgDone()

job to job
	observerJob: _onTgDone, _tgH
	target: _obH
job to chan
	observerJob: _onTgDone, _tgH
	target: has .putters and .receiverS
job to timer
	observerJob: _onTgDone, _tgH
	target: _obH


promise to job
	observer: _onTgDone, _tgH (not necessary bc no cancellation)
	target: _obH
*/




export const EMPTY = Symbol("EM")

/* **************   System   ************************************************ */

class System {
	#stack: Array<Job> = []  // todo: optimize to Linked List
	runningJob!: Job
	justDone!: Chan | Job

	deadline = 5000
	targetJob!: Job
	cancelCallerJob!: Job
	cancelTargetJobs!: Job[]

	// todo: optimize to Node based LL
	pushJob(job: Job) {
		this.runningJob = job
		this.#stack.push(job)
	}

	popJob() {
		return this.runningJob = this.#stack.pop()
	}
}

export const sys = new System()


/* **************   Linked Lists   ****************************************** */

/* Lexicon
Target = Job | Chan
Observer = Job | Chan
LL: Linked List
ob: Observer
	Waits for a Target to call back with data/result
nt: Target
	Calls back to observer with data/result
*/


// todo: maybe Ch does not need .val
/**
 * A Job or a Channel that can:
 *   - Notify a result (as a Job) or data (as a Channel) to its observers.
 *	  - Subscribe to a notifier to get data/result from.
*/
export type Linkable<Produces = unknown> = {
	val: Produces
} & Ob


/**
 * Waits for a Target to notify back with data/result
 * tg: Target
 */

/**
 *	  - Subscribe to a target to get data/result from.
 */

/** Observer
 * _onTgDone = onTargetDone
 * 	target calls this to notify observer it's result.
 * _tgH = targets LL Head
 * 	head of targets LL that I'm awaiting a data/result (to be removed from if cancelled)
 * rmTg = removeTarget
 * 	method to remove target from observer's LL
 */
export type Ob = {
	_onTgDone: (val: unknown, targetJobFailed?: boolean) => void
	_tg: Link<Ob, Job>  // Head of targets LL that I'm awaiting a data/result (to be removed from if cancelled)
	rmTg: (link: Link<Ob, Job>) => void
}

export abstract class ObBase implements Ob {
	_tg = EMPTY_LINK as Link<Ob, Job>

	rmTg(link: Link<Ob, Job>) {
		link.pB.nB = link.nB
		link.nB.pB = link.pB
		if (link.pB == EMPTY_LINK) {
			this._tg = link.nB
		}
		disposeLink(link)
	}

	abstract _onTgDone(val: unknown): void
}

export type Target = {
	_obH?: typeof EMPTY_LINK | Link<unknown, Ob>  // Head of observers LL that needs to be notified
	// addOb: (ob: Obs) => void
}

/**
 * Used as a LL Node ("Link") for Observers <-> Targets and several other LLs (some are single LL)
 * A is Observer (or a generic object)
 * B is Target
 * nA is next Observer Link (towards the tail of LL)
 * pA is previous Observer Link
 * nB is next Target Link (towards the tail of LL)
 * pB is previous Target Link
 *
 * todo: more documentation
 */
export class Link<A = unknown, B = unknown> {
	constructor(
		public a: A,
		public b: B,
		public ntf = true
	) {}
	nA = EMPTY_LINK as Link<A, B>
	pA = EMPTY_LINK as Link<A, B>
	nB = EMPTY_LINK as Link<A, B>
	pB = EMPTY_LINK as Link<A, B>
}

/**
 * Pool of links to be reused.
 * Is a single LL.
 * We use Link's .nA to link to next available Link in pool.
 */

let linkPoolHead: Link | undefined = undefined

export const EMPTY_LINK = new Link(EMPTY, EMPTY) as Link<unknown, unknown>

export function disposeLink(link: Link) {

	link.nA = linkPoolHead ?? EMPTY_LINK
	linkPoolHead = link

	link.a = EMPTY
	link.b = EMPTY
	link.ntf = false
	link.pA = EMPTY_LINK
	link.nB = EMPTY_LINK
	link.pB = EMPTY_LINK
}

export function freshLink<A, B>(a: A, b: B, ntf = true) {
	if (!linkPoolHead) {
		return new Link(a, b, ntf)
	}

	let link = linkPoolHead

	const { nA } = link
	linkPoolHead = nA === EMPTY_LINK ? undefined : nA
	link.nA = link

	link.a = a
	link.b = b
	link.ntf = ntf

	return link as Link<A, B>
}
