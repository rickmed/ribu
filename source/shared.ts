import { type Job } from "./job.ts"


export const EMPTY = Symbol("EM")

/* **************   System   ************************************************ */

class System {
	#stack: Array<Job> = []  // todo: optimize to Linked List
	runningJob!: Job
	deadline = 5000

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

export let iterRes = {
	done: false,
	value: 0 as unknown,
}
export type Iter<V> = Iterator<unknown, V>
export const iter = {
	next() {
		return iterRes
	}
}


/* **************   Linked Lists   ****************************************** */

/* Lexicon
Observer = Job, Select..
Target = Job, Chan, Sleep, Select...
LL: Linked List
ob: Observer
	Waits for a Target to call back with data/result
tg: Target
	Calls back to observer with data/result
*/


/** Observer
 * _onTgDone = onTargetDone
 * 	Target calls this to notify me with data/result.
 * _tg = targets LL Head
 * 	Head of targets LL that I'm awaiting data/result.
 *		Needed to remove Observer from all targets if cancelled.
 * _addTg = addTarget to ._tg
 * _rmTg = removeTarget from ._tg
 */
export type Ob = {
	_onTgDone: (val: unknown, tg: Tg) => void
	_tg: Link<Ob, Tg>
	_addTg: (link: Link<Ob, Tg>) => void
	_rmTg: (link: Link<Ob, Tg>) => void
}

/** Target
 * _ob: Link<Ob, Tg>,
 * 	Head of observers LL that I will call back with data/result
 * _addOb = addObserver to ._ob
 * _rmOb = removeObserver from ._ob
 */
export type Tg = {
	_ob: Link<Ob, Tg>
	_addOb: (link: Link<Ob, Tg>) => void
	_rmOb: (link: Link<Ob, Tg>) => void
	_st: number
}

/** Link
 * Used as a LL Node for Observers <-> Targets and several other LLs (some are single LL)
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
	link.pA = EMPTY_LINK
	link.nB = EMPTY_LINK
	link.pB = EMPTY_LINK
}

export function freshLink<A, B>(a: A, b: B) {
	if (!linkPoolHead) {
		return new Link(a, b)
	}

	let link = linkPoolHead

	const { nA } = link
	linkPoolHead = nA === EMPTY_LINK ? undefined : nA
	link.nA = link

	link.a = a
	link.b = b

	return link as Link<A, B>
}



export function linkObAndTg(ob: Ob, tg: Tg) {
	const link = freshLink(ob, tg)
	ob._addTg(link)
	tg._addOb(link)
}

export function unlinkObAndTg(link: Link<Ob, Tg>) {
	link.a._rmTg(link)
	link.b._rmOb(link)
	disposeLink(link)
}
