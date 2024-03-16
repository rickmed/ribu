export function promSleep(ms: number): Promise<void> {
	return new Promise(res => setTimeout(res, ms))
}

export function eqType<T>(x: T) {x}

export function* range(start: number, end?: number) {
	if (end === undefined) {
		end = start
		for (let i = 0; i < end; i++) {
			yield i
		}
		return
	}

	for (let i = start; i < end; i++) {
		yield i
	}
}