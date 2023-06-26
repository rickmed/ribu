import { _go, _Ch, _wait, CSP as _CSP } from "../source/core.mjs"

/** @param {number} ms */
export function sleep(ms) {
	return new Promise(res => {
		setTimeout(() => {
			res(true)
		}, ms)
	})
}


export function CSP() {
	const csp = new _CSP()
	const clock = new Clock()

	/* No need to create a shared prototype to limit memory usage since these will be use sparingly */
	return {
		go: _go(csp),
		Ch: _Ch(csp),
		wait: _wait(clock.setTimeout.bind(clock), csp),
		clock,
	}
}



/** =========================================================== */
class Clock {

	/** @type {Array<{ms: number, cb: _Ribu.VoidCB}>} */
	sheduledCallbacks = []


	/** @type {(ms: number) => Promise<boolean>}  - returns true if there was a scheduled callback. False otherwise */
	async tick(ms) {

		const allScheduled = this.sheduledCallbacks

		let currScheduled = allScheduled[0]

		if (currScheduled === undefined) {
			return false
		}

		/** @type {Array<Promise<true>>} */
		let proms_when_CBs_are_fired = []

		while (ms >= currScheduled.ms) {

			const { cb } = currScheduled

			const prom_when_cb_is_fired = new Promise(res => {
				globalThis.setTimeout(() => { cb(); res(true) }, 0)
			})

			proms_when_CBs_are_fired.push(prom_when_cb_is_fired)

			const _currScheduled = allScheduled.shift()

			if (_currScheduled === undefined) {
				break
			}

			currScheduled = _currScheduled
		}

		await Promise.all(proms_when_CBs_are_fired)
		return true
	}


	/** @type {_Ribu.SetTimeout} */
	setTimeout(cb, ms) {

		/**
		 * inserts the callback maintaining order by ms ascending
		 * could use something like LL and binary search, but good enough for now
		 */
		const scheduledCBs = this.sheduledCallbacks
		const l = scheduledCBs.length
		let i = 0
		while (i < l) {
			const scheduledCB_ms = scheduledCBs[i].ms
			if (ms <= scheduledCB_ms) {
				break
			}
			i++
		}

		scheduledCBs.splice(i, 0, { cb, ms })
	}

}