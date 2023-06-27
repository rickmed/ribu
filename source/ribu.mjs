import { Proc } from "./Proc.mjs"
import { Prc, YIELD_VAL } from "./Prc.mjs"
import { Chan } from "./channels.mjs"

import { csp } from "./initCsp.mjs"


/**
 * @param {_Ribu.Gen_or_GenFn} gen_or_genFn
 * @param {{}=} opts
 * @returns {Ribu.Proc}
 */
export function go(gen_or_genFn, opts) {
   const prc = new Prc(gen_or_genFn, csp)
   const proc = new Proc(prc)

   // @todo
   // if (opts !== undefined) {
      // for (const k in opts) {
      //    const _proc = /** @type {{}} */proc
      //    _proc[k] = opts[k]
      // }
   // }

   prc.run()
   return proc
}


/**
 * @template Tval=undefined
 * @type {(capacity?: number) => Ribu.Ch<Tval>}
 */
export function ch(capacity = 1) {
   return new Chan(capacity, csp)
}


/** @type {(ms: number) => _Ribu.YIELD | never} */
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


/** @type {(...procS: Ribu.Proc[]) => Ribu.Ch | never} */
export function done(...procS_) {

   const done = /** @type {Ribu.Ch} */ (ch())

   /** @type {Array<Ribu.Proc> | Set<_Ribu.Prc>} */
   let procS = procS_

   if (procS.length === 0) {
      const {runningPrc} = csp
      if (runningPrc === undefined) {
         throw new Error(`ribu: can't call done without parameters and outside a generator function`)
      }
      const {childPrcS} = runningPrc
      if (childPrcS === undefined) {
         return done
      }
      procS = childPrcS
   }

   go(function* _donePrc() {
      const procSDone = []
      for (const proc of procS) {
         procSDone.push(proc.done)
      }
      yield all(...procSDone).rec
      yield done.put()
   })

   return done
}


/** @type {(fn: _Ribu.GenFn | Function) => void} */
function onCancel(fn) {
   const {runningPrc} = csp
   if (runningPrc === undefined) {
      throw new Error(`ribu: can't call onCancel outside a generator function`)
   }
   runningPrc.cancelFn = fn
}


/** @type {(...procS: Ribu.Proc[]) => Ribu.Ch} */
export function cancel(...procS) {
	const procCancelChanS = procS.map(p => p.cancel())
	return all(...procCancelChanS)
}


/** @type {(...chanS: Ribu.Ch[]) => Ribu.Ch} */
export function all(...chanS) {
	const allDone = /** @type {Ribu.Ch} */ (ch())
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


/** @type {(...chanS: Ribu.Ch[]) => Ribu.Ch} */
export function or(...chanS) {
	const anyDone = /** @type {Ribu.Ch} */ (ch())
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


/** @type {(fn: Function) => Ribu.Ch} */
export function runAsync(fn) {
   const done = /** @type {Ribu.Ch}} */ (ch())
   go(function* _runAsync() {
      fn()
      yield done.put()
   })
   return done
}


/** @type {(done?: Ribu.Ch) => Ribu.Ch} */
export function async(done = /** @type {Ribu.Ch}} */ (ch())) {
   go(function* _async() {
      yield done.put()
   })
   return done
}
