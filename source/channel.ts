import { type Job, type TheIterable } from "./job.ts"
import { runningJob } from "./system.ts"
import { Queue } from "./data-structures.ts"

// todo: if job is done, skip in putters/receivers queue.

export function Ch<V = undefined>(): Chan<V> {
	return new Chan<V>()
}

export function isCh(x: unknown): x is Chan {
	return x instanceof Chan
}

export interface OutCh<in V> {
	put: (msg: V) => TheIterable<undefined>
	enQ: (msg: V) => void
}

interface InCh<out V> {
	rec: TheIterable<V>
}

export class Chan<V = undefined> implements OutCh<V>, InCh<V> {

	puttersQ = new Queue<Job>()
	receiversQ = new Queue<Job>()
	_done = false

	done() {
		this._done = true
	}

	get rec() {
		let recJob = runningJob()
		let putJob = this.puttersQ.deQ()


		if (!putJob) {
			this.receiversQ.enQ(recJob)
			return recJob._park<V>()
		}

		const msg = putJob._io
		putJob._resume()
		return recJob._continue<V>(msg)
	}

	put(msg: V): TheIterable<undefined>
	put(...msg: V extends undefined ? [] : [V]): TheIterable<undefined>
	put(msg?: V): TheIterable<undefined> {
		// @todo
		// if (this.closed) {
		// 	throw Error(`can't put() on a closed channel`)
		// }

		let putJob = runningJob()
		let recJob = this.receiversQ.deQ()

		if (!recJob) {
			this.puttersQ.enQ(putJob)
			return putJob._park(msg)
		}

		recJob._resume(msg)
		return putJob._continue()
	}

	get notDone() {
		return this.puttersQ.isEmpty ? false : true
	}

	enQ(msg: V): void
	enQ(...msg: V extends undefined ? [] : [V]): void
	enQ(msg?: V): void {
		// todo...for js callbacks to put things to channel.
		// if job, is done, do nothing.
	}
}

export function putAsync<V>(ch: Chan<V>, msg: V): void {
	ch.enQ(msg)
}

export function addRecPrcToCh(ch: Chan, prc: Job): void {
	ch.receiversQ.enQ(prc)
}
