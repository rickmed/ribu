const iterations = 100_000

// Create a value to use as a side effect
let sideEffect = 0

// Pre-create all objects we'll need to avoid measuring object creation overhead
const syncObjects = new Array(iterations).fill(null).map(() => {
	return {
		method1() {
			// Simple operation to avoid optimization
			sideEffect = 1
			return sideEffect
		}
	}
})

const thenables = new Array(iterations).fill(null).map(() => {
	return {
		then(resolve: (value: string) => void) {
			// Simple operation to avoid optimization
			sideEffect = 1
			resolve("hi")
		}
	}
})

const promises = new Array(iterations).fill(null).map(() => {
	return new Promise<string>((resolve) => {
		// Simple operation to avoid optimization
		sideEffect = 1
		resolve("hi")
	})
})

// Single sync method calls
let syncSingleTotalTime = 0
let currentObj
for (let i = 0; i < iterations; i++) {
	// Get the object reference before timing to avoid array lookup overhead
	currentObj = syncObjects[i]!
	const startTime = performance.now()
	currentObj.method1()
	const endTime = performance.now()
	syncSingleTotalTime += (endTime - startTime)
}
const syncSingleAverage = syncSingleTotalTime / iterations
console.log(`Sync method calls: ${syncSingleTotalTime.toFixed(2)}ms (${syncSingleAverage.toFixed(6)}ms per iteration)`)


// Thenable awaits
let thenableTotalTime = 0
let currentThenable
for (let i = 0; i < iterations; i++) {
	// Get the object reference before timing
	currentThenable = thenables[i]!
	const startTime = performance.now()
	await currentThenable
	const endTime = performance.now()
	thenableTotalTime += (endTime - startTime)
}
const thenableAverage = thenableTotalTime / iterations
console.log(`Thenable awaits: ${thenableTotalTime.toFixed(2)}ms (${thenableAverage.toFixed(6)}ms per iteration)`)

// Pre-resolved promise awaits
let promiseTotalTime = 0
let currentPromise
for (let i = 0; i < iterations; i++) {
	// Get the object reference before timing
	currentPromise = promises[i]!
	const startTime = performance.now()
	await currentPromise
	const endTime = performance.now()
	promiseTotalTime += (endTime - startTime)
}
const promiseAverage = promiseTotalTime / iterations
console.log(`Native promise awaits: ${promiseTotalTime.toFixed(2)}ms (${promiseAverage.toFixed(6)}ms per iteration)`)

// Single reused promise for comparison
const singlePromise = Promise.resolve("hi")
let reusedPromiseTotalTime = 0
for (let i = 0; i < iterations; i++) {
	const startTime = performance.now()
	await singlePromise
	const endTime = performance.now()
	reusedPromiseTotalTime += (endTime - startTime)
}
const reusedPromiseAverage = reusedPromiseTotalTime / iterations
console.log(`Reused native promise awaits: ${reusedPromiseTotalTime.toFixed(2)}ms (${reusedPromiseAverage.toFixed(6)}ms per iteration)`)
