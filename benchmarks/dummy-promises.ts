const sleepProm = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))


export async function prom0Deep(sleepMs: number) {
	if (sleepMs) {
		await sleepProm(sleepMs)
	}
}

export async function prom1Deep(sleepMs: number) {
	if (sleepMs) {
		await sleepProm(sleepMs)
	}
	await prom0Deep(sleepMs)
}

export async function prom2Deep(sleepMs: number) {
	if (sleepMs) {
		await sleepProm(sleepMs)
	}
	await prom1Deep(sleepMs)
}

export async function nSequentialProms0Deep(nProms: number, sleepMs = 0) {
	for (let i = 0; i < nProms; i++) {
		await prom0Deep(sleepMs)
	}
}

export async function nConcurrentPromsEach3Deep(nProms: number, sleepMs = 0) {
	let proms: Promise<void>[] = []
	for (let i = 0; i < nProms; i++) {
		proms.push(prom2Deep(sleepMs))
	}
	await Promise.all(proms)
}
