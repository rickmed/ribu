import { run } from "mitata"

type Results = Awaited<ReturnType<typeof run>>

export function sortedReport(results: Results) {
	const data = results.benchmarks
		.map(b => {
			const run = b.runs[0]!
			return {
				name: run.name,
				avg: run.stats?.avg,
				iterations: run.stats?.ticks,
				total: run.stats!.avg * run.stats!.ticks,
			}
		})
		.toSorted((a, b) => a.avg - b.avg)

	const fastest = data[0]!

	for (const test of data) {
		const ratio = test.avg / fastest.avg
		const ratioText = test == fastest ? "1x" : `${ratio.toFixed(2)}x slower`
		const totalText = `${(test.total / 1000).toFixed(2)}s`
		console.log(`${test.name}  ${ratioText}  ${totalText}`)
	}
}