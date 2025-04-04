import { sleep } from "ribu"

export function sleepProm(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

export function* incCountonDoneJob(ctx: {count: number}) {
	yield* sleep(5)
	ctx.count++
}

export function* child2(ctx: {count: number}) {
	yield* sleep(5)
	ctx.count++
}