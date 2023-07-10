import { go } from "./Prc.mjs"
import { ch } from "./channels.mjs"
import csp from "./initCsp.mjs"


/**
 * @template [TVal=undefined]
 * @typedef {Ribu.Ch<TVal>} Ch<TVal>
 */

/** @typedef {Ribu.Proc} Proc */


/** @type {(...procS: Proc[]) => Ch | never} */
export function wait(...procS) {

	const allDone = ch()

	/** @type {Array<Ch>} */
	let doneChs
	if (procS.length === 0) {

		const { runningPrc } = csp

		if (runningPrc === undefined) {
			throw new Error(`ribu: can't call done without parameters and outside a generator function`)
		}

		const { _$childS: $childPrcS } = runningPrc

		if ($childPrcS === undefined) {
			return allDone
		}

		const prcDoneChs = []
		for (const prc of $childPrcS) {
			prcDoneChs.push(prc.done)
		}
		doneChs = prcDoneChs
	}
	else {
		doneChs = procS.map(proc => proc.done)
	}


	go(function* _donePrc() {
		yield all(...doneChs).rec
		yield allDone.put()
	})

	return allDone
}


/** @type {(fn: _Ribu.GenFn | Function) => void} */
export function onCancel(fn) {
	const { runningPrc } = csp
	if (runningPrc === undefined) {
		throw new Error(`ribu: can't call onCancel outside a generator function`)
	}
	runningPrc.onCancel = fn
}


/** @type {(...procS: Proc[]) => Ch} */
export function cancel(...procS) {
	const procCancelChanS = procS.map(p => p.cancel())
	return all(...procCancelChanS)
}


/** @type {(...chanS: Ch[]) => Ch} */
export function all(...chanS) {

	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		go(function* _all() {
			yield chan.rec
			yield notifyDone.put()
		})
	}

	go(function* _collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			yield notifyDone.rec
			nDone++
		}
		yield allDone.put()
	})

	return allDone
}


/** @type {(...chanS: Ch[]) => Ch} */
export function or(...chanS) {
	const anyDone = ch()
	let done = false

	for (const chan of chanS) {
		go(function* () {
			yield chan.rec
			if (done === true) {
				return
			}
			done = true
			yield anyDone.put()
		})
	}

	return anyDone
}


/** @type {(fn: Function, done?: Ch) => Ch} */
export function doAsync(fn, done = ch()) {
	go(function* _doAsync() {
		fn()
		yield done.put()
	})
	return done
}