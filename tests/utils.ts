import { _Err } from "../source/errors.ts"

export async function checkAsyncFnThrows(fn: () => Promise<unknown>) {
	try {
		await fn()
		throw Error("function should have thrown")
	}
	catch (e) {
		return e
	}
}

export function sleepProm(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}
