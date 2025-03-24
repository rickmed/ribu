export { go, onEnd, cancel,type Job as Job, me, type RibuGen } from "./job.js"
export { sleep } from "./timers.js"
// export { Ch, type OutCh, type InCh } from "./channel.js"
export { userErrCtor as Err, isErr, Err as RibuErr, CANC_OK, CancOK } from "./errors.js"
// export { all, allOrErr, first, firstOK, promToJob } from "./job-helpers.js"

/**
 * Creates a deep copy of an object using JSON serialization.
 *
 * Note: This method has limitations:
 * - Functions, undefined values, and symbols will be lost
 * - Date objects will be converted to strings
 * - It doesn't handle circular references
 *
 * @param obj The object to deep copy
 * @returns A deep copy of the input object
 */
export function deepCopy<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj)) as T
}
