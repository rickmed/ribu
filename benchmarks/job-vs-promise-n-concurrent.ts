import { bench, run } from "mitata"
import { Banca } from "./banca.js"
import { lg } from "../test/setup.js"
import { nConcurrentJobsEach3Deep } from "./dummy-jobs.js"
import { nConcurrentPromsEach3Deep } from "./dummy-promises.js"
import { sortedReport } from "./mitata-utils.js"


/* ****************** */
/* One parent, n concurrent children, each 3 levels deep */
/* ****************** */

const iterations = 100_000
const sleepMs = 0

await new Banca({iterations})
	.add("Jobs 3 concurrent", async () => {
		await nConcurrentJobsEach3Deep(3, sleepMs)
	}, {gc: true})

	.add("Promises 3 concurrent", async () => {
		await nConcurrentPromsEach3Deep(3, sleepMs)
	}, {gc: true})
	// .disable()
	.run(lg)

await new Banca({iterations})
	.add("Jobs 10 concurrent", async () => {
		await nConcurrentJobsEach3Deep(10, sleepMs)
	}, {gc: true})

	.add("Promises 10 concurrent", async () => {
		await nConcurrentPromsEach3Deep(10, sleepMs)
	}, {gc: true})
	.disable()
	.run(lg)

await new Banca({iterations})
	.add("Jobs 20_000 concurrent", async () => {
		await nConcurrentJobsEach3Deep(20_000)
	}, {gc: true})

	.add("Promises 20_000 concurrent", async () => {
		await nConcurrentPromsEach3Deep(20_000)
	}, {gc: true})
	.disable()
	.run(lg)


bench("Jobs 3 concurrent", async () => {
	await nConcurrentJobsEach3Deep(3, sleepMs)
}).gc("inner")

bench("Promises 3 concurrent", async () => {
	await nConcurrentPromsEach3Deep(3, sleepMs)
}).gc("inner")

// bench("Jobs 10 concurrent", async () => {
// 	await nConcurrentJobsEach3Deep(10, sleepMs)
// }).gc("inner")

// bench("Promises 10 concurrent", async () => {
// 	await nConcurrentPromsEach3Deep(10, sleepMs)
// }).gc("inner")

// bench("Jobs 20_000 concurrent", async () => {
// 	await nConcurrentJobsEach3Deep(20_000)
// }).gc("inner")

// bench("Promises 20_000 concurrent", async () => {
// 	await nConcurrentPromsEach3Deep(20_000)
// }).gc("inner")

const results = await run()
sortedReport(results)
