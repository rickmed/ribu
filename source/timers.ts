import { TheIterable, getRunningPrc, theIterable } from "./initSystem.js"
import { sleepTimeout } from "./process.js"

export function sleep(ms: number) {
	let runningPrc = getRunningPrc()

	const timeoutID = setTimeout(function setTO() {
		runningPrc.resume(undefined)
	}, ms)

	runningPrc[sleepTimeout] = timeoutID
	runningPrc._park(undefined)
	return theIterable as TheIterable<void>
}

export function Timeout(ms: number) {
   return new _Timeout(ms)
}

class _Timeout {
   constructor(ms: number) {
      
   }

}