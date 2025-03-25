import { bench, run } from "mitata"
import { sortedReport } from "./mitata-utils.js"
import { Banca } from "./banca.js"
import { lg } from "../tests/setup.js"


class Thenable {
	then(resolve: (value: unknown) => void) {
		resolve("hi")
	}
}

const theThenableClass = new Thenable()

let resolveThenable: (value: unknown) => void

const theThenable = {
	then(resolve: (value: unknown) => void) {
		console.log(resolveThenable)
		console.log(resolveThenable === resolve)
		resolveThenable = resolve
		resolve("hi")
	}
}

await theThenable
await theThenable

while(true){}

const thePromise = new Promise((resolve) => {
	resolve("prom")
})

async function awaitThenable() {
	await theThenable
}

async function awaitPromise() {
	await thePromise
}


const innerIters = 100_000

await new Banca({iterations: 1_000})
	.add("Thenable class", async () => {
		for (let i = 0; i < innerIters; i++) {
			await theThenable
		}
	}, {gc: true})
	.add("Promise", async () => {
		for (let i = 0; i < innerIters; i++) {
			await thePromise
		}
	}, {gc: true})
	.disable()
	.run(lg)


let promTime = 0

for (let i = 0; i < innerIters; i++) {
	const start = performance.now()
	await thePromise
	const end = performance.now()
	const diff = end - start
	promTime += diff
}
console.log("Promise")
console.log("avg", promTime / innerIters)

let thenableTime = 0

for (let i = 0; i < innerIters; i++) {
	const start = performance.now()
	await theThenable
	const end = performance.now()
	const diff = end - start
	thenableTime += diff
}

console.log("thenable")
console.log("avg", thenableTime / innerIters)

const obj = {
	method() {
		return "hi"
	}
}

let objTime = 0

for (let i = 0; i < innerIters; i++) {
	const start = performance.now()
	obj.method()
	const end = performance.now()
	const diff = end - start
	objTime += diff
}

console.log("obj.method()")
console.log("avg", objTime / innerIters)

console.log("obj vs promise", promTime / objTime)
console.log("promise vs thenable", thenableTime / promTime)

// bench("Thenable Class", async () => {
// 	await theThenableClass
// }).gc("inner")

// bench("Promise", async () => {
// 	await thePromise
// }).gc("inner")

// bench("Create Promise", async () => {
// 	await (new Promise((resolve) => {
// 		resolve("hi")
// 	}))
// }).gc("inner")

// const results = await run()
// sortedReport(results)
