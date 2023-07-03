import { Prc, YIELD_VAL } from "./Prc.mjs"
import { Chan } from "./Chan.mjs"
import { Csp } from "./Csp.mjs"


/**
 * @template [TVal=undefined]
 * @typedef {_Ribu.Ch<TVal>} Ch<TVal>
 */

/** @typedef {Ribu.Proc} Proc */
/** @typedef {_Ribu.Conf} Conf */


const csp = new Csp()


/**
 * @template {Conf} TConf
 * @param {_Ribu.Gen_or_GenFn} gen_or_genFn
 * @param {(TConf extends _Ribu.ProcShape ? never : TConf)=} conf
 * @returns {Proc & TConf}
 */
export function go(gen_or_genFn, conf) {

	const gen = gen_or_genFn instanceof Function ? gen_or_genFn() :
		gen_or_genFn

   const prc = new Prc(gen, csp)

   const ProcPrototype = {
      done: prc.done,
      cancel: prc.cancel.bind(prc)
   }

	// /** @type {Proc & TConf} */
   const proc = Object.create(ProcPrototype)

   if (conf !== undefined) {
      for (const k in conf) {
         const optsVal = conf[k]
         proc[k] = optsVal
      }
   }

   prc.run()
   return proc
}


/**
 * @type {(capacity?: number) => Ch}
 */
export function ch(capacity = 1) {
	const newch = new Chan(capacity, csp)
   return newch
}


/** @type {(ms: number) => YIELD_VAL | never} */
export function sleep(ms) {

   const procBeingRan = csp.runningPrc
   if (procBeingRan === undefined) {
      throw new Error(`ribu: can't call sleep outside a generator function`)
   }

   // @todo: not using yield down here is weird
   go(function* sleepPrc() {  // eslint-disable-line require-yield

      const timeoutID = setTimeout(() => {
         procBeingRan.setResume()
         procBeingRan.run()
      }, ms)

      onCancel(() => clearTimeout(timeoutID))
   })

   return YIELD_VAL
}


/** @type {(...procS: Proc[]) => Ch | never} */
export function done(...procS_) {

   const allDone = ch()

   /** @type {Array<Proc> | Set<Proc>} */
   let procS = procS_

   if (procS.length === 0) {
      const {runningPrc} = csp
      if (runningPrc === undefined) {
         throw new Error(`ribu: can't call done without parameters and outside a generator function`)
      }
      const {$childPrcS: childPrcS} = runningPrc
      if (childPrcS === undefined) {
         return allDone
      }
      procS = childPrcS
   }

   go(function* _donePrc() {
      const procSDone = []
      for (const proc of procS) {
         procSDone.push(proc.done)
      }
      yield all(...procSDone).rec
      yield allDone.put()
   })

   return allDone
}


/** @type {(fn: _Ribu.GenFn | Function) => void} */
function onCancel(fn) {
   const {runningPrc} = csp
   if (runningPrc === undefined) {
      throw new Error(`ribu: can't call onCancel outside a generator function`)
   }
   runningPrc.cancelFn = fn
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
		go(function* () {
			yield chan.rec
			yield notifyDone.put()
		})
	}

	go(function* collectDones() {
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


/** @type {(fn: Function) => Ch} */
export function doAsync(fn) {
   const done = ch()
   go(function* _doAsync() {
      fn()
      yield done.put()
   })
   return done
}


// /** @type {(done?: Ch) => Ch} */
// export function async(done = ch()) {
//    go(function* _async() {
//       yield done.put()
//    })
//    return done
// }


/**
 * @implements {Ch}
 */
export class BroadcastCh {

	/** @type {Ch | Array<Ch> | undefined} */
	#listeners = undefined

	/** @return {YIELD_VAL} */
	get rec() {

		const listenerCh = ch()
		const listeners = this.#listeners

		if (listeners === undefined) {
			this.#listeners = listenerCh
		}
		else if (Array.isArray(listeners)) {
			listeners.push(listenerCh)
		}
		else {
			this.#listeners = []
			this.#listeners.push(listenerCh)
		}

		return listenerCh.rec
	}

	/** @type {() => YIELD_VAL} */
	put() {

		const notifyDone = ch()
		const listeners = this.#listeners

		go(function* _emit() {
			if (listeners === undefined) {
				yield notifyDone.rec
				return
			}
			if (Array.isArray(listeners)) {
				for (const ch of listeners) {
					yield ch.put()
				}
				yield notifyDone.rec
				return
			}
			yield listeners.put()
			yield notifyDone.rec
		})

		return notifyDone.put()
	}
}
