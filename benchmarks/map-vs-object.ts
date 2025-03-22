import { bench, run } from "mitata"
import { sortedReport } from "./mitata-utils.js"

// Configuration
const iterations = 100_000

// Test objects
let obj1 = { a: 1, b: 2 }
let obj2 = { a: 1, b: 2 }

// Benchmark: Object property access
bench("Ref comparison", () => {
	return obj1 === obj2 // Different objects with same content
})
	.gc("inner")

// Benchmark: Map.get access
bench("Prop assignment", () => {
	return obj1.a = 3
})
	.gc("inner")


// Run and report results
const results = await run()
sortedReport(results)