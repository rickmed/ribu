import { Chan } from "./channel.ts"
import { type Job } from "./job.ts"

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
Notifier = Job | Chan
Observer = Job | Chan
LL: Linked List
ob: Observer
	Waits for a Notifier to notify back with data/result
nt: Notifier
	Notifies back to observer with data/result
*/


// todo: maybe Ch does not need .val
/**
 * A Job or a Channel that can:
 *   - Notify a result (as a Job) or data (as a Channel) to its observers.
 *	  - Subscribe to a notifier to get data/result from.
*/
export type Linkable<Produces = unknown> = {
	val: Produces
} & Observer

export type Observer = {
	_onNtDone: (val: unknown, notifierJobFailed?: boolean) => void
	_ntH?: Link<Notifier, unknown>  // Head of notifiers LL that I'm awaiting a data/result (to be removed from if cancelled)
}

export type Notifier = {
	_obH?: Link<unknown, Observer>  // Head of observers LL that needs to be notified
}

/**
 * Used a LL Node for Observers <-> Notifiers and several other LLs (some as single LL)
 * A is Notifier (or any target)
 * B is Observer (or any counterpart)
 * n is next Node
 * p is previous Node
 */
export class Link<A, B> {
	constructor(
		public a: A,
		public b: B,
		public ntf = true
	) {}
	nA = undefined as unknown as this
	pA = undefined as unknown as this
	nB = undefined as unknown as this
	pB = undefined as unknown as this
}

export type ObsLL<Obs> = Link<unknown, Obs>
export type NtsLL<Nts> = Link<Nts, unknown>

let linkPoolHead: Link<unknown, unknown> | undefined = undefined

type NoLink = Link<unknown, unknown>

export function disposeLink(link: Link<unknown, unknown>) {

	link.nA = linkPoolHead ?? undefined as unknown as NoLink
	linkPoolHead = link

	link.a = undefined as unknown as Job
	link.b = undefined as unknown as Job
	link.ntf = false
	link.pA = undefined as unknown as NoLink
	link.nB = undefined as unknown as NoLink
	link.pB = undefined as unknown as NoLink
}

export function freshLink<A, B>(a: A, b?: B, ntf = true) {
	if (!linkPoolHead) {
		return new Link(a, b, ntf)
	}

	let link = linkPoolHead

	linkPoolHead = link.nA
	link.nA = undefined as unknown as Link<A, B>

	link.a = a
	link.b = b
	link.ntf = ntf

	return link as Link<A, B>
}
