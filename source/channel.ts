import { addTgLink, Job, PARKED, PARKED_CH_PUT, PARKED_CH_REC, removeTgLink, resumeJob } from "./job.js"
import { SYS_ITERABLE, freshLink, iterRes, type Link, type VoidLink, VOID_LINK, disposeLink, sys, throwNotYielded } from "./system.js"


/*

** User can have "buffered" channels by:
	ch.enQ(1)
	ch.enQ(2)
	check (ch.size === 3)
	yield* ch.put(3)
*/

type PutterJob = Job
type PutterJobLink = Link<PutterJob, 0>
type enQLink = Link<unknown, 1>
export type PutterLink = PutterJobLink | enQLink

type ReceiverJob = Job
export type ReceiverLink = Link<ReceiverJob, ReceiverJob>


/** Chan Class
 *  _rc:
 * 	LL of receiver jobs waiting for putter to put their msg.
 *  _pt:
 * 	LL of putter jobs waiting for receiver to take their msg.
 *
 *  Dequeues from head.
 *  Enqueues to tail.
 *  _pt/_rc .pA points to tail so we can enqueue jobs into LL's tail.
 */
export class Chan<V = undefined> implements OutCh<V>, InCh<V> {

	_st = 0  // todo: necessary?
	_size = 0
	_done = false
	_pt: PutterLink | VoidLink = VOID_LINK
	_rc: ReceiverLink | VoidLink = VOID_LINK

	get rec() {
		const recJob = sys.runningJob
		if (recJob._st & PARKED) {
			throwNotYielded("ch.rec")
		}

		const { _pt } = this

		// No putter waiting, so enqueue and block receiver.
		if (_pt === VOID_LINK) {

			// Enqueue receiver as LL tail
			const link = freshLink(recJob, recJob)

			const { _rc } = this
			if (_rc === VOID_LINK) {
				this._rc = link
				link.pA = link  // Head points to tail
			} else {
				let tail = _rc.pA
				tail.nA = link
				link.pA = tail
				_rc.pA = link  // Update Head pointer to tail.
			}

			// Add link to receiver Job so it can unlink if cancelled.
			addTgLink(recJob, link)

			// Block receiver
			recJob._st |= PARKED_CH_REC
			iterRes.done = false
		}
		else {  // There's a putter waiting, so resume both receiver and putter.
			this._size--

			// Remove putter from _pt LL (is head).
			let nextLink = _pt.nA
			if (nextLink === VOID_LINK) {
				this._pt = VOID_LINK
			} else {
				const tail = _pt.pA
				nextLink.pA = tail
				this._pt = nextLink
			}

			// Resume putter (first, if it's a job), then receiver.

			const putType = _pt.b
			const putVal = _pt.a


			if (putType === 0) {  // putter is a job
				const putJob = putVal as Job
				const msg = putJob.val
				removeTgLink(putJob, _pt)
				resumeJob(putJob)
				iterRes.value = msg
			}
			else {  // putter is a value from .enQ()
				iterRes.value = putVal
			}

			disposeLink(_pt)
			iterRes.done = true
		}

		return CHAN_ITERABLE as SYS_ITERABLE<V>
	}

	put(msg: PutVal<V>) {
		const putJob = sys.runningJob
		if (putJob._st & PARKED) {
			throwNotYielded("ch.put")
		}

		const link = pullRecLink(this)

		// No receiver waiting, so enqueue and block putter.
		if (link === false) {
			this._size++
			const link = freshLink(putJob, 0 as const)
			enQPutter(this, link)
			// Add link to putter Job so it can unlink if cancelled.
			addTgLink(putJob, link)
			putJob._st |= PARKED_CH_PUT
			putJob.val = msg
			iterRes.done = false
		}
		// There's a receiver waiting, so resume receiver (first) and putter.
		else {
			const recjob = link.a
			removeTgLink(recjob, link)
			resumeJob(recjob, msg)
			disposeLink(link)
			iterRes.value = undefined
			iterRes.done = true
		}

		return CHAN_ITERABLE as SYS_ITERABLE<undefined>
	}

	enQ(msg: PutVal<V>): void {
		this._size++
		const link = pullRecLink(this)
		if (link === false) {
			const link = freshLink(msg, 1 as const)
			enQPutter(this, link)
			return
		}
		resumeJob(link.a, msg)
		disposeLink(link)
	}

	size() {
		return this._size
	}

	// todo
	// they're maybe values in queue by putter jobs waiting or inserted by enQueue
	// get notDone() {
	// }

	// todo
	// setDone() {
	// 	this._done = true
	// }

}

function pullRecLink<V>(ch: Chan<V>) {
	const { _rc } = ch

	if (_rc === VOID_LINK) {
		return false
	}

	// Remove receiver from _rc LL (is head).
	let nextLink = _rc.nA
	if (nextLink === VOID_LINK) {
		ch._rc = VOID_LINK
	} else {
		ch._rc = nextLink
		const tail = _rc.pA
		nextLink.pA = tail
	}
	return _rc as ReceiverLink
}

function enQPutter<V>(ch: Chan<V>, link: PutterLink) {
	const { _pt } = ch
	if (_pt === VOID_LINK) {
		ch._pt = link
		link.pA = link  // Head points to tail
	} else {
		let tail = _pt.pA
		tail.nA = link
		link.pA = tail
		_pt.pA = link  // Update Head pointer to tail.
	}
}

export const CHAN_ITERATOR = {
	next() {
		return iterRes
	}
}
const CHAN_ITERABLE = {
	[Symbol.iterator]() {
		return CHAN_ITERATOR
	}
}

export function enQueue<V>(ch: Chan<V>, msg: PutVal<V>): void {
	ch.enQ(msg)
}

function throwIfDone<V>(ch: Chan<V>) {
	if (ch._done) {
		throw Error(`can't put() on a closed channel`)
	}
}





/* *********************  API  ******************** */

export function Ch<V = undefined>(): Chan<V> {
	return new Chan<V>()
}

export function isCh(x: unknown): x is Chan {
	return x instanceof Chan
}

export type OutCh<in V> = {
	put: (msg: PutVal<V>) => SYS_ITERABLE<undefined>
	enQ: (msg: PutVal<V>) => void
}

export type InCh<out V> = {
	rec: SYS_ITERABLE<V>
}

// todo, type for unclosable channel

type PutVal<V> = V extends undefined ? void : V
