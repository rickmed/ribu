import { go, ch } from "./ribu.mjs"

const INIT = 1, CANCELLING = 2, CANCEL_DONE = 3

/**
 * @implements {Ribu.Proc}
 */
export class Proc {

	#prc
	done = /** @type {Ribu.Ch} */ (ch())

	/** @type {INIT | CANCELLING | CANCEL_DONE} */
	#state = INIT

	/**
	 * To track when redundant/concurrent prc.cancel() calls
	 * @type {Array<Ribu.Ch> | undefined}
	 */
	#waiters = undefined

	/** @param {_Ribu.Prc} prc */
	constructor(prc) {
		this.done = prc.done
		this.#prc = prc
	}

	/** @type {(deadline?: number) => Ribu.Ch} */
	cancel(deadline) {

		const done = /** @type {Ribu.Ch}} */ (ch())
		const state = this.#state

		if (state === CANCEL_DONE) {
			return done
		}

		if (state === CANCELLING) {
			if (this.#waiters === undefined) {
				this.#waiters = []
			}
			const _done = /** @type {Ribu.Ch}} */ (ch())
			this.#waiters.push(_done)
			return done
		}

		this.#state = CANCELLING

		go(function* _cancel() {
			yield this.#prc.cancel(deadline)
			this.#state = CANCEL_DONE
			const waiters = this.#waiters
			if (waiters !== undefined) {
				for (const ch of waiters) {
					yield ch.put()
				}
			}
			yield done.put()
		})

		return done
	}
}



/*

child.cancel() is called, just after, grandparent.cancel() is called.
what happens?
	it really is concurrent calls to child.cancel()
	I think I need to move concu cancel() calls logic from Proc to Prc
		but would need to save some state in Prc's fields (like in Proc)
	ORRRR/better:
		let Prc have channels (expose as fields) that other things can send/receive
		this way I think I could manage the whole logic on one method and save
		state in the closure.

		DOES this work?

*/