import { sleep } from "ribu"
import { RibuErr } from "../source/errors.js"

export function Er<Name extends string>(name: Name, fnName = "", msg = "", errs?: RibuErr["_errs"], onEndErrs?: RibuErr["_oe"]) {
	return new RibuErr<Name>(name, fnName, errs, onEndErrs, msg)
}

export function sleepProm(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

export function* incCountOnDoneJob(ctx: {count: number}) {
	yield* sleep(5)
	ctx.count++
}

export function* child2(ctx: {count: number}) {
	yield* sleep(5)
	ctx.count++
}