import { go, Prc } from "./process.mjs"
import { ch, Ch } from "./channel.mjs"
import csp from "./initCsp.mjs"


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