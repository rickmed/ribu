import { type Prc } from "./process.js"
import { EUncaught } from "./errors.js"

export class System {
	deadline = 5000
	prcStack: Array<Prc> = []

	get runningPrc() {
		return this.prcStack.at(-1)
	}

	onUncaughtInCancel_m = function (err: EUncaught) {
		console.log(err)  // eslint-disable-line no-console
	}
}

export const sys = new System()

export function onUncaughtInCancel(fn: typeof sys.onUncaughtInCancel_m) {
	sys.onUncaughtInCancel_m = fn
}

export function getRunningPrc() {
	const prc = sys.runningPrc
	if (!prc) {
		throw Error(`ribu: no process running`)
	}
	return prc
}


export let theIterResult = {
	done: false,
	value: 0 as unknown,
}


export const theIterator: TheIterator<any> = {
	next() {
		const runningPrc = getRunningPrc()
		const runningStatus = runningPrc._status
		if (runningStatus === "PARK") {
			theIterResult.done = false
			// can leave same iterRes.value because will be ignored by yield* and prc.resume()
			return theIterResult
		}
		theIterResult.done = true
		theIterResult.value = runningPrc._IOmsg
		return theIterResult
	}
}

const symbolIterator = Symbol.iterator

export const theIterable = {
	[symbolIterator]() {
		return theIterator
	}
}

export type TheIterable<V> = {
	[Symbol.iterator](): Iterator<unknown, V>
}

export type TheIterator<V> = Iterator<unknown, V>