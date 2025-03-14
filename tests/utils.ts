import { expect } from "vitest"
import { Err, _Err } from "ribu"

export function checkErr(rec: unknown, exp: unknown) {
	assertRibuErr(rec)
	expect(rec).toEqual(exp)
	expect(rec).toBeInstanceOf(Err)
}

export function assertRibuErr(x: unknown): asserts x is Err {
	expect(x).toBeInstanceOf(Err)
}

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
