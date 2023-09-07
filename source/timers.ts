import { TheIterable, getRunningPrc, theIterable } from "./system.js"

export function sleep(ms: number) {
	let runningPrc = getRunningPrc()

	const timeoutID = setTimeout(function setTO() {
		runningPrc.resume()
	}, ms)

	runningPrc._sleepTimeout = timeoutID
	runningPrc._setPark()
	return theIterable as TheIterable<void>
}

export function Timeout(ms: number) {
   return new _Timeout(ms)
}

class _Timeout {
   constructor(ms: number) {

   }

}