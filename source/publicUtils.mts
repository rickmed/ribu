import { go, Prc } from "./Prc.mts"
import { ch, Ch } from "./channels.mts"
import csp from "./initCsp.mts"


export function wait(...prcS: Prc[]): Ch | never {

	const allDone = ch()

	let doneChs: Array<Ch>
	if (prcS.length === 0) {

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
		doneChs = prcS.map(proc => proc.done)
	}


	go(function* _donePrc() {
		yield all(...doneChs).rec
		yield allDone.put()
	})

	return allDone
}


export function cancel(...prcS: Prc[]): Ch {
	const procCancelChanS = prcS.map(p => p.cancel())
	return all(...procCancelChanS)
}


export function all(...chanS: Ch[]): Ch {

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


export function or(...chanS: Ch[]): Ch {
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


export function doAsync(fn: Function, done = ch()): Ch {
	go(function* _doAsync() {
		fn()
		yield done.put()
	})
	return done
}