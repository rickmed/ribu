import { status, IOmsg, type Prc } from "./process.js"


export class System {
	deadline = 5000
	prcStack: Array<Prc> = []

	get runningPrc() {
		return this.prcStack.at(-1)
	}
}

export const sys = new System()

export function getRunningPrc() {
	const prc = sys.runningPrc
	if (!prc) {
		throw Error(`ribu: no process running`)
	}
	return prc
}


let iterRes = {
	done: false,
	value: 0 as unknown,
}

const iterator = {
	next(): IteratorResult<unknown> {
		const runningPrc = sys.runningPrc
		if (runningPrc[status] === "PARK") {
			iterRes.done = false
			// same iterRes.value bc will be ignored by yield*
			return iterRes
		}
		iterRes.done = true
		iterRes.value = runningPrc[IOmsg]
		return iterRes
	}
}


export type TheIterable<V = unknown> = {
	[Symbol.iterator](): Iterator<unknown, V>
}

export const theIterable: TheIterable = {
	[Symbol.iterator]() {
		return iterator
	}
}
