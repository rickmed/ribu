import { bench, run } from "mitata"
import { sortedReport } from "./mitata-utils.js"

const COUNT = 1_000
const WAIT_TIME_MS = 1


let currGen = undefined as unknown as Generator<string, unknown, unknown>


bench("Simple Gen", async () => {

	let jobsDone = COUNT
	let jobs: Generator<string, unknown, unknown>[] = []

	await new Promise(resolve => {
		for (let i = 0; i < COUNT; i++) {

			function* sleep(ms: number) {
				setTimeout(() => {
					const currGen = jobs[i]
					currGen.next()
					jobsDone--
					if (jobsDone === 0) {
						resolve(undefined)
					}
				}, ms)
				yield "block"
			}

			function* child() {
				yield* sleep(WAIT_TIME_MS)
			}


			function* main() {
				yield* child()
				return "main done"
			}

			currGen = main()
			jobs.push(currGen)
			currGen.next()
		}
	})


}).gc("inner")


let promsDone = 0

const sleepProm = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))


async function promChild() {
	await sleepProm(WAIT_TIME_MS)
	promsDone--
	if (promsDone === 0) {
		promsDone = COUNT
	}
}

async function mainProm() {
	await sleepProm(WAIT_TIME_MS)
	await promChild()
}

bench("Promises", async () => {
	promsDone = COUNT
	let proms: Promise<void>[] = []
	for (let i = 0; i < COUNT; i++) {
		proms.push(mainProm())
	}
	await Promise.all(proms)
}).gc("inner")



const results = await run()
sortedReport(results)