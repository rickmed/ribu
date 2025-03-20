export class Banca {
	cases: Case[] = []
	iterations: number = 100_000
	results = new Results(this)
	disabled = false

	constructor(opts?: {iterations?: number}) {
		this.iterations = opts?.iterations ?? this.iterations
	}

	add(name: string, fn: CaseFn, opts: CaseOpts): this {
		this.cases.push(new Case(name, fn, opts))
		return this
	}

	disable() {
		this.disabled = true
		return this
	}

	async run(logFn?: (str: string) => void) {
		if (this.disabled) {
			return
		}

		if (this.cases.length === 0) {
			throw new Error("No cases to run")
		}

		for (const c of this.cases) {

			let iters = this.iterations
			for (let i = 0; i < iters; i++) {
				c.startIterTime = process.hrtime()
				if (c.isAsync) {
					await c.fn(c)
				} else {
					(c.fn as (c?: Case) => void)(c)
				}
				this.#measure(c)
			}

			if (c.opts.gc && global.gc) {
				global.gc()
			}
		}

		this.results.calculate()
		if (logFn) {
			this.printReport(logFn)
		}
	}

	#measure(c: Case) {
		if (!c.iterMeasured) {
			_measure(c)
		}
		c.iterMeasured = false
	}

	report() {
		return this.results.report()
	}

	printReport(logFn: (str: string) => void) {
		logFn(this.report())
	}
}

class Results {
	bench: Banca
	fastestCase!: Case
	reportStr = ""

	constructor(bench: Banca) {
		this.bench = bench
	}

	calculate() {
		const {iterations} = this.bench
		const { cases } = this.bench

		this.bench.cases.sort((a, b) => a.duration - b.duration)
		const fastestDuration = this.bench.cases[0]!.duration
		for (const c of cases) {
			c.avg = c.duration / iterations
			c.slowRatio = c.duration / fastestDuration
		}
		return this
	}

	report() {
		if (this.reportStr !== "") {
			return this.reportStr
		}
		let printStr = ""
		for (const c of this.bench.cases) {
			const formatAvg = formatTime(c.avg)
			const ratio = c.slowRatio === 1 ? "1x" : `${c.slowRatio.toFixed(2)}x slower`
			printStr += `${c.name} - ${ratio} - ${formatAvg} \n`
		}
		this.reportStr = printStr
		return printStr
	}
}

function formatTime(nanoseconds: number): string {
	if (nanoseconds >= 1_000_000) {
		return `${(nanoseconds / 1_000_000).toFixed(2)} ms/iter`
	} else if (nanoseconds >= 1_000) {
		return `${(nanoseconds / 1_000).toFixed(2)} µs/iter`
	} else {
		return `${nanoseconds.toFixed(2)} ns/iter`
	}
}


type CaseFn = (c: Case) => void | Promise<void>
type CaseOpts = {
	gc: boolean
}

export class Case {
	fn: CaseFn
	name: string
	duration: number = 0
	isAsync: boolean
	opts: CaseOpts
	iterMeasured = false
	startIterTime: [number, number] = [0, 0]
	avg: number = 0
	slowRatio: number = 0

	constructor(name: string, fn: CaseFn, opts: CaseOpts) {
		this.name = name
		this.fn = fn
		this.isAsync = fn.constructor.name === "AsyncFunction"
		this.opts = opts
	}

	startMeasure() {
		this.startIterTime = process.hrtime()
	}

	measure() {
		_measure(this)
		this.iterMeasured = true
	}
}


function _measure(c: Case) {
	const [_, nano] = process.hrtime(c.startIterTime)
	c.duration += nano
}
