export { go, onEnd, type Job as Job, me, RibuGen,cancel } from "./job.ts"
export { sleep } from "./timers.ts"
export { Ch, OutCh } from "./channel.ts"
export { userErrCtor as Err, isErr, Err as RibuErr, CANC_OK, CancOK } from "./errors.ts"
export { all, allOrErr, first, firstOK, promToJob } from "./job-helpers.ts"

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
