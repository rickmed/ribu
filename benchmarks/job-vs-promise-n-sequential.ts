import { bench, run } from "mitata"
import { Banca } from "./banca.js"
import { lg } from "../test/setup.js"
import { go } from "../source/job.js"
import { sortedReport } from "./mitata-utils.js"
import { nSequentialJobs0Deep } from "./dummy-jobs.js"
import { nSequentialProms0Deep } from "./dummy-promises.js"


/* ****************** */
/* One parent, n sequential children. 0 deep */
/* ****************** */

const iterations = 100
const nSequential1 = 1_000
const nSequential2 = 100_000
const sleepMs = 0

await new Banca({iterations})
	.add(`Jobs ${nSequential1} sequential`, async () => {
		await go(nSequentialJobs0Deep, nSequential1, sleepMs)
	}, {gc: true})

	.add(`Promises ${nSequential1} sequential`, async () => {
		await nSequentialProms0Deep(nSequential1, sleepMs)
	}, {gc: true})
	.disable()
	.run(lg)

await new Banca({iterations})
	.add(`Jobs ${nSequential2} sequential`, async () => {
		await go(nSequentialJobs0Deep, nSequential2, sleepMs)
	}, {gc: true})

	.add(`Promises ${nSequential2} sequential`, async () => {
		await nSequentialProms0Deep(nSequential2, sleepMs)
	}, {gc: true})
	// .disable()
	.run(lg)


bench(`Jobs ${nSequential1} sequential`, async () => {
	await go(nSequentialJobs0Deep, nSequential1, sleepMs)
}).gc("inner")

bench(`Promises ${nSequential1} sequential`, async () => {
	await nSequentialProms0Deep(nSequential1, sleepMs)
}).gc("inner")

bench(`Jobs ${nSequential2} sequential`, async () => {
	await go(nSequentialJobs0Deep, nSequential2, sleepMs)
}).gc("inner")

bench(`Promises ${nSequential2} sequential`, async () => {
	await nSequentialProms0Deep(nSequential2, sleepMs)
}).gc("inner")

const results = await run()
sortedReport(results)
